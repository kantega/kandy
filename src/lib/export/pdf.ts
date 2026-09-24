/**
 * PDF writer.
 *
 * Uses pdf-lib with the PDF standard fonts. That keeps the output small and the
 * text selectable and extractable, and it avoids pulling in `@pdf-lib/fontkit`
 * plus a bundled TTF — the standard fonts are WinAnsi/CP1252 encoded, which
 * already covers æ ø å Æ Ø Å. See `winansi.ts` for how out-of-repertoire
 * characters are handled.
 */

import type { PDFFont, PDFPage, PDFDocument, RGB } from "pdf-lib";
import type { Block, InlineSpan } from "./types";
import { toWinAnsi } from "./winansi";

/** `rgb` from pdf-lib, threaded through so the module can stay lazily loaded. */
type RgbFn = (red: number, green: number, blue: number) => RGB;

/** A4 in PostScript points. */
const PAGE_WIDTH = 595.28;
const PAGE_HEIGHT = 841.89;
const MARGIN = 56;
const CONTENT_WIDTH = PAGE_WIDTH - MARGIN * 2;

const BODY_SIZE = 10.5;
const LINE_HEIGHT = 1.42;
const TITLE_SIZE = 20;
const SUBTITLE_SIZE = 10;
const INDENT_STEP = 18;
const PARAGRAPH_GAP = 6;

const HEADING_SIZES: Record<number, number> = {
  1: 16,
  2: 13.5,
  3: 11.5,
  4: 10.5,
  5: 10.5,
  6: 10.5,
};

interface FontSet {
  regular: PDFFont;
  bold: PDFFont;
  italic: PDFFont;
  boldItalic: PDFFont;
  mono: PDFFont;
  monoBold: PDFFont;
}

/** A measured, style-carrying piece of a laid-out line. */
interface Piece {
  text: string;
  font: PDFFont;
  width: number;
}

type Line = Piece[];

/** A token is either a word or the whitespace between two words. */
interface Token {
  text: string;
  font: PDFFont;
  isSpace: boolean;
}

function fontFor(fonts: FontSet, span: InlineSpan): PDFFont {
  if (span.code) return span.bold ? fonts.monoBold : fonts.mono;
  if (span.bold && span.italic) return fonts.boldItalic;
  if (span.bold) return fonts.bold;
  if (span.italic) return fonts.italic;
  return fonts.regular;
}

/** Split spans into whitespace-delimited tokens, keeping each token's font. */
function tokenize(
  spans: readonly InlineSpan[],
  fonts: FontSet,
  forcedFont?: PDFFont,
): Token[] {
  const tokens: Token[] = [];

  for (const span of spans) {
    const font = forcedFont ?? fontFor(fonts, span);
    const text = toWinAnsi(span.text);
    for (const part of text.split(/(\s+)/)) {
      if (part === "") continue;
      tokens.push({ text: part, font, isSpace: /^\s+$/.test(part) });
    }
  }

  return tokens;
}

/** Break a single over-long token (a URL, say) into chunks that fit. */
function breakToken(token: Token, size: number, maxWidth: number): Piece[] {
  const pieces: Piece[] = [];
  let current = "";

  for (const char of token.text) {
    const candidate = current + char;
    if (
      current !== "" &&
      token.font.widthOfTextAtSize(candidate, size) > maxWidth
    ) {
      pieces.push({
        text: current,
        font: token.font,
        width: token.font.widthOfTextAtSize(current, size),
      });
      current = char;
    } else {
      current = candidate;
    }
  }

  if (current !== "") {
    pieces.push({
      text: current,
      font: token.font,
      width: token.font.widthOfTextAtSize(current, size),
    });
  }

  return pieces;
}

/** Greedy line breaking over styled tokens. */
function wrap(
  tokens: readonly Token[],
  size: number,
  maxWidth: number,
): Line[] {
  const lines: Line[] = [];
  let line: Line = [];
  let lineWidth = 0;

  const pushLine = () => {
    // Trailing spaces would skew centring and are invisible anyway.
    while (line.length > 0 && line[line.length - 1].text.trim() === "") {
      line.pop();
    }
    lines.push(line);
    line = [];
    lineWidth = 0;
  };

  for (const token of tokens) {
    const width = token.font.widthOfTextAtSize(token.text, size);

    if (token.isSpace) {
      // Never start a line with a space.
      if (line.length === 0) continue;
      line.push({ text: token.text, font: token.font, width });
      lineWidth += width;
      continue;
    }

    if (lineWidth + width <= maxWidth) {
      line.push({ text: token.text, font: token.font, width });
      lineWidth += width;
      continue;
    }

    if (line.length > 0) pushLine();

    if (width <= maxWidth) {
      line.push({ text: token.text, font: token.font, width });
      lineWidth = width;
    } else {
      const chunks = breakToken(token, size, maxWidth);
      chunks.forEach((chunk, i) => {
        line.push(chunk);
        lineWidth += chunk.width;
        if (i < chunks.length - 1) pushLine();
      });
    }
  }

  if (line.length > 0) pushLine();
  if (lines.length === 0) lines.push([]);

  return lines;
}

/** Walks down the page, starting new pages as it runs out of room. */
class Cursor {
  private page: PDFPage;
  private y: number;
  readonly pages: PDFPage[] = [];

  constructor(
    private readonly doc: PDFDocument,
    private readonly rgb: RgbFn,
  ) {
    this.page = doc.addPage([PAGE_WIDTH, PAGE_HEIGHT]);
    this.pages.push(this.page);
    this.y = PAGE_HEIGHT - MARGIN;
  }

  private newPage(): void {
    this.page = this.doc.addPage([PAGE_WIDTH, PAGE_HEIGHT]);
    this.pages.push(this.page);
    this.y = PAGE_HEIGHT - MARGIN;
  }

  /** Reserve vertical space, breaking to a new page if it does not fit. */
  reserve(height: number): void {
    if (this.y - height < MARGIN) this.newPage();
  }

  /** Add vertical gap, but never leave a stranded gap at the top of a page. */
  gap(amount: number): void {
    if (this.y < PAGE_HEIGHT - MARGIN) this.y -= amount;
  }

  drawLine(line: Line, x: number, size: number, gray: number): void {
    const lineBox = size * LINE_HEIGHT;
    this.reserve(lineBox);
    this.y -= lineBox;
    let cursorX = x;
    for (const piece of line) {
      if (piece.text.trim() !== "") {
        this.page.drawText(piece.text, {
          x: cursorX,
          // Sit the baseline above the descender rather than on the box edge.
          y: this.y + size * 0.24,
          size,
          font: piece.font,
          color: this.rgb(gray, gray, gray),
        });
      }
      cursorX += piece.width;
    }
  }

  drawRule(gray: number): void {
    this.reserve(8);
    this.y -= 8;
    this.page.drawLine({
      start: { x: MARGIN, y: this.y },
      end: { x: PAGE_WIDTH - MARGIN, y: this.y },
      thickness: 0.5,
      color: this.rgb(gray, gray, gray),
    });
  }

  /**
   * Draw a list marker against the line the cursor is currently sitting on.
   * Must be called immediately after the {@link drawLine} for that line, so
   * that any page break has already been taken.
   */
  drawMarker(marker: string, x: number, size: number, font: PDFFont): void {
    this.page.drawText(toWinAnsi(marker), {
      x,
      y: this.y + size * 0.24,
      size,
      font,
      color: this.rgb(0.13, 0.13, 0.13),
    });
  }
}

function orderedMarker(index: number, depth: number): string {
  // Alternate numbers and letters by nesting level, the way Word does.
  if (depth % 2 === 1) {
    return `${String.fromCharCode(97 + ((index - 1) % 26))}.`;
  }
  return `${index}.`;
}

function bulletMarker(depth: number): string {
  const markers = ["•", "–", "·"];
  return markers[depth % markers.length];
}

/** Render the block list onto a fresh pdf-lib document and return the bytes. */
export async function renderPdf(
  title: string,
  subtitle: string | undefined,
  blocks: readonly Block[],
): Promise<Uint8Array> {
  const pdfLib = await import("pdf-lib");
  const { StandardFonts, rgb } = pdfLib;

  const doc = await pdfLib.PDFDocument.create();
  doc.setTitle(title);
  doc.setCreator("Kandy");
  doc.setProducer("Kandy");

  const fonts: FontSet = {
    regular: await doc.embedFont(StandardFonts.Helvetica),
    bold: await doc.embedFont(StandardFonts.HelveticaBold),
    italic: await doc.embedFont(StandardFonts.HelveticaOblique),
    boldItalic: await doc.embedFont(StandardFonts.HelveticaBoldOblique),
    mono: await doc.embedFont(StandardFonts.Courier),
    monoBold: await doc.embedFont(StandardFonts.CourierBold),
  };

  const cursor = new Cursor(doc, rgb);

  // --- Title block -------------------------------------------------------
  const titleTokens = tokenize(
    [{ text: title, bold: true, italic: false, code: false }],
    fonts,
  );
  for (const line of wrap(titleTokens, TITLE_SIZE, CONTENT_WIDTH)) {
    cursor.drawLine(line, MARGIN, TITLE_SIZE, 0.05);
  }

  if (subtitle) {
    cursor.gap(2);
    const subtitleTokens = tokenize(
      [{ text: subtitle, bold: false, italic: false, code: false }],
      fonts,
    );
    for (const line of wrap(subtitleTokens, SUBTITLE_SIZE, CONTENT_WIDTH)) {
      cursor.drawLine(line, MARGIN, SUBTITLE_SIZE, 0.45);
    }
  }

  cursor.gap(6);
  cursor.drawRule(0.75);
  cursor.gap(10);

  // --- Body --------------------------------------------------------------
  for (const block of blocks) {
    switch (block.kind) {
      case "heading": {
        const size = HEADING_SIZES[block.level] ?? BODY_SIZE;
        cursor.gap(block.level <= 2 ? 12 : 8);
        const tokens = tokenize(
          block.spans.map((s) => ({ ...s, bold: true })),
          fonts,
        );
        const lines = wrap(tokens, size, CONTENT_WIDTH);
        // Keep a heading with at least its first body line.
        cursor.reserve(size * LINE_HEIGHT * (lines.length + 1));
        for (const line of lines) cursor.drawLine(line, MARGIN, size, 0.05);
        cursor.gap(3);
        break;
      }

      case "paragraph": {
        const x = MARGIN + block.depth * INDENT_STEP;
        const tokens = tokenize(block.spans, fonts);
        for (const line of wrap(tokens, BODY_SIZE, PAGE_WIDTH - MARGIN - x)) {
          cursor.drawLine(line, x, BODY_SIZE, 0.13);
        }
        cursor.gap(PARAGRAPH_GAP);
        break;
      }

      case "listItem": {
        const markerX = MARGIN + block.depth * INDENT_STEP;
        const textX = markerX + INDENT_STEP;
        const marker = block.ordered
          ? orderedMarker(block.index, block.depth)
          : bulletMarker(block.depth);
        const tokens = tokenize(block.spans, fonts);
        const lines = wrap(tokens, BODY_SIZE, PAGE_WIDTH - MARGIN - textX);

        lines.forEach((line, i) => {
          cursor.drawLine(line, textX, BODY_SIZE, 0.13);
          // The marker belongs to the first line only, and has to be drawn
          // after drawLine has moved the cursor onto that line's baseline.
          if (i === 0) {
            cursor.drawMarker(marker, markerX, BODY_SIZE, fonts.regular);
          }
        });
        cursor.gap(2);
        break;
      }

      case "quote": {
        const x = MARGIN + block.depth * INDENT_STEP + INDENT_STEP;
        const tokens = tokenize(
          block.spans.map((s) => ({ ...s, italic: true })),
          fonts,
        );
        for (const line of wrap(tokens, BODY_SIZE, PAGE_WIDTH - MARGIN - x)) {
          cursor.drawLine(line, x, BODY_SIZE, 0.38);
        }
        cursor.gap(PARAGRAPH_GAP);
        break;
      }

      case "code": {
        const size = BODY_SIZE - 1;
        for (const raw of block.text.replace(/\n+$/, "").split("\n")) {
          const tokens = tokenize(
            [{ text: raw || " ", bold: false, italic: false, code: true }],
            fonts,
            fonts.mono,
          );
          const lines = wrap(tokens, size, CONTENT_WIDTH - INDENT_STEP);
          for (const line of lines) {
            cursor.drawLine(line, MARGIN + INDENT_STEP, size, 0.25);
          }
        }
        cursor.gap(PARAGRAPH_GAP);
        break;
      }

      case "rule": {
        cursor.gap(4);
        cursor.drawRule(0.8);
        cursor.gap(8);
        break;
      }
    }
  }

  // --- Page numbers ------------------------------------------------------
  const total = cursor.pages.length;
  if (total > 1) {
    cursor.pages.forEach((page, i) => {
      const label = `${i + 1} / ${total}`;
      const width = fonts.regular.widthOfTextAtSize(label, 8.5);
      page.drawText(label, {
        x: (PAGE_WIDTH - width) / 2,
        y: MARGIN / 2,
        size: 8.5,
        font: fonts.regular,
        color: rgb(0.55, 0.55, 0.55),
      });
    });
  }

  return doc.save();
}
