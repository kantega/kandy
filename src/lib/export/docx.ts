/**
 * Word (.docx) writer.
 *
 * Built on `docx`, which emits real WordprocessingML — headings become Word
 * heading styles, lists become numbered/bulleted list paragraphs, and bold and
 * italic become character formatting. The file therefore stays editable in Word
 * rather than arriving as one undifferentiated block of text.
 */

import type {
  IRunOptions,
  ISectionOptions,
  Paragraph as DocxParagraph,
} from "docx";
import type { Block, HeadingLevel, InlineSpan } from "./types";

/** Word list level indents, in twentieths of a point (twips). */
const INDENT_PER_LEVEL = 360;
const MAX_LIST_LEVEL = 4;

/** `docx` numbering reference names, defined in {@link buildNumbering}. */
const ORDERED_REF = "kandy-ordered";
const BULLET_REF = "kandy-bullet";

type DocxModule = typeof import("docx");

function runOptionsFor(span: InlineSpan): IRunOptions {
  const options: IRunOptions = {
    text: span.text,
    bold: span.bold,
    italics: span.italic,
  };
  if (span.code) {
    return { ...options, font: "Consolas", size: 19 };
  }
  return options;
}

function runsFor(docx: DocxModule, spans: readonly InlineSpan[]) {
  if (spans.length === 0) return [new docx.TextRun("")];
  return spans.map((span) => new docx.TextRun(runOptionsFor(span)));
}

function headingStyleFor(docx: DocxModule, level: HeadingLevel) {
  switch (level) {
    case 1:
      return docx.HeadingLevel.HEADING_1;
    case 2:
      return docx.HeadingLevel.HEADING_2;
    case 3:
      return docx.HeadingLevel.HEADING_3;
    case 4:
      return docx.HeadingLevel.HEADING_4;
    case 5:
      return docx.HeadingLevel.HEADING_5;
    default:
      return docx.HeadingLevel.HEADING_6;
  }
}

/**
 * Multi-level numbering definitions.
 *
 * `docx` will happily accept a `numbering.reference` that does not exist, and
 * Word then silently renders the paragraph without a marker — so both the
 * ordered and bullet definitions are declared up front for every level we can
 * emit.
 */
function buildNumbering(docx: DocxModule) {
  const orderedFormats = [
    "decimal",
    "lowerLetter",
    "lowerRoman",
    "decimal",
    "lowerLetter",
  ] as const;
  const bulletChars = ["•", "◦", "▪", "•", "◦"];

  const levels = (kind: "ordered" | "bullet") =>
    Array.from({ length: MAX_LIST_LEVEL + 1 }, (_unused, level) => ({
      level,
      format: kind === "ordered" ? orderedFormats[level] : ("bullet" as const),
      text: kind === "ordered" ? `%${level + 1}.` : bulletChars[level],
      alignment: docx.AlignmentType.LEFT,
      style: {
        paragraph: {
          indent: {
            left: INDENT_PER_LEVEL * (level + 1),
            hanging: 260,
          },
        },
      },
    }));

  return {
    config: [
      { reference: ORDERED_REF, levels: levels("ordered") },
      { reference: BULLET_REF, levels: levels("bullet") },
    ],
  };
}

function blockToParagraphs(docx: DocxModule, block: Block): DocxParagraph[] {
  switch (block.kind) {
    case "heading":
      return [
        new docx.Paragraph({
          heading: headingStyleFor(docx, block.level),
          spacing: { before: 220, after: 90 },
          children: runsFor(docx, block.spans),
        }),
      ];

    case "paragraph":
      return [
        new docx.Paragraph({
          spacing: { after: 130, line: 288 },
          indent:
            block.depth > 0
              ? { left: INDENT_PER_LEVEL * (block.depth + 1) }
              : undefined,
          children: runsFor(docx, block.spans),
        }),
      ];

    case "listItem":
      return [
        new docx.Paragraph({
          numbering: {
            reference: block.ordered ? ORDERED_REF : BULLET_REF,
            level: Math.min(block.depth, MAX_LIST_LEVEL),
          },
          spacing: { after: 60, line: 288 },
          children: runsFor(docx, block.spans),
        }),
      ];

    case "quote":
      return [
        new docx.Paragraph({
          spacing: { after: 130, line: 288 },
          indent: { left: INDENT_PER_LEVEL * (block.depth + 1) },
          border: {
            left: { style: docx.BorderStyle.SINGLE, size: 12, color: "CCCCCC" },
          },
          children: block.spans.map(
            (span) =>
              new docx.TextRun({
                ...runOptionsFor(span),
                italics: true,
                color: "555555",
              }),
          ),
        }),
      ];

    case "code":
      // One Word paragraph per source line, so line breaks survive.
      return block.text
        .replace(/\n+$/, "")
        .split("\n")
        .map(
          (line) =>
            new docx.Paragraph({
              spacing: { after: 0, line: 260 },
              indent: { left: INDENT_PER_LEVEL },
              shading: { fill: "F4F4F4" },
              children: [
                new docx.TextRun({ text: line, font: "Consolas", size: 19 }),
              ],
            }),
        );

    case "rule":
      return [
        new docx.Paragraph({
          spacing: { before: 130, after: 130 },
          border: {
            bottom: {
              style: docx.BorderStyle.SINGLE,
              size: 6,
              color: "CCCCCC",
            },
          },
          children: [],
        }),
      ];
  }
}

/** Render the block list into .docx bytes. */
export async function renderDocx(
  title: string,
  subtitle: string | undefined,
  blocks: readonly Block[],
): Promise<Uint8Array> {
  const docx = await import("docx");

  const children: DocxParagraph[] = [
    new docx.Paragraph({
      heading: docx.HeadingLevel.TITLE,
      spacing: { after: subtitle ? 40 : 200 },
      children: [new docx.TextRun({ text: title, bold: true })],
    }),
  ];

  if (subtitle) {
    children.push(
      new docx.Paragraph({
        spacing: { after: 220 },
        children: [
          new docx.TextRun({ text: subtitle, color: "6B6B6B", size: 20 }),
        ],
      }),
    );
  }

  for (const block of blocks) {
    children.push(...blockToParagraphs(docx, block));
  }

  const section: ISectionOptions = {
    properties: {
      page: {
        margin: { top: 1134, bottom: 1134, left: 1134, right: 1134 },
      },
    },
    children,
  };

  const doc = new docx.Document({
    title,
    creator: "Kandy",
    description: subtitle,
    numbering: buildNumbering(docx),
    styles: {
      default: {
        document: {
          run: { font: "Calibri", size: 22 },
        },
      },
      // `docx` leans on docDefaults alone, which leaves body paragraphs with no
      // resolvable style. Word copes, but stricter OOXML readers report the
      // style as missing — so declare Normal explicitly.
      paragraphStyles: [
        {
          id: "Normal",
          name: "Normal",
          quickFormat: true,
          run: { font: "Calibri", size: 22 },
        },
      ],
    },
    sections: [section],
  });

  // `toBlob` is the browser-safe packer; `toBuffer` needs Node's Buffer.
  const blob = await docx.Packer.toBlob(doc);
  return new Uint8Array(await blob.arrayBuffer());
}
