/**
 * Text sanitising for the PDF writer.
 *
 * The PDF export draws with the PDF standard fonts (Helvetica / Courier), which
 * pdf-lib encodes as WinAnsi — i.e. CP1252. That covers all of Latin-1, so the
 * Norwegian letters æ ø å Æ Ø Å round-trip natively and no font has to be
 * embedded. The trade-off is that a character outside CP1252 makes pdf-lib
 * throw at draw time, and LLM-written summaries regularly contain arrows,
 * check marks and the odd emoji. Everything drawn into the PDF therefore goes
 * through {@link toWinAnsi} first.
 */

/**
 * The 27 printable CP1252 code points in the 0x80–0x9F range, which is where
 * CP1252 differs from ISO-8859-1.
 */
const CP1252_HIGH = new Set([
  0x20ac, 0x201a, 0x0192, 0x201e, 0x2026, 0x2020, 0x2021, 0x02c6, 0x2030,
  0x0160, 0x2039, 0x0152, 0x017d, 0x2018, 0x2019, 0x201c, 0x201d, 0x2022,
  0x2013, 0x2014, 0x02dc, 0x2122, 0x0161, 0x203a, 0x0153, 0x017e, 0x0178,
]);

/** True if pdf-lib can encode this code point with a WinAnsi standard font. */
export function isWinAnsiEncodable(codePoint: number): boolean {
  return (
    (codePoint >= 0x20 && codePoint <= 0x7e) ||
    (codePoint >= 0xa0 && codePoint <= 0xff) ||
    CP1252_HIGH.has(codePoint)
  );
}

/**
 * Readable stand-ins for characters that show up often in generated summaries
 * but have no CP1252 equivalent.
 */
const REPLACEMENTS = new Map<string, string>([
  ["→", "->"],
  ["⇒", "=>"],
  ["←", "<-"],
  ["⇐", "<="],
  ["↔", "<->"],
  ["✓", "v"],
  ["✔", "v"],
  ["✗", "x"],
  ["✘", "x"],
  ["☑", "[x]"],
  ["☐", "[ ]"],
  ["★", "*"],
  ["☆", "*"],
  ["▪", "-"],
  ["▫", "-"],
  ["●", "-"],
  ["○", "-"],
  ["◦", "-"],
  ["‣", "-"],
  // U+2015 horizontal bar and U+2011 non-breaking hyphen. The en dash (U+2013),
  // em dash (U+2014), bullet (U+2022) and ellipsis (U+2026) are all in CP1252
  // and are deliberately left untouched.
  ["―", "-"],
  ["‑", "-"],
  ["≥", ">="],
  ["≤", "<="],
  ["≠", "!="],
  ["≈", "~"],
  [" ", " "],
  [" ", " "],
  [" ", " "],
  ["​", ""],
  ["﻿", ""],
  ["\t", "    "],
]);

/**
 * Coerce a string into something the WinAnsi standard fonts can draw.
 *
 * Strategy, in order: an explicit replacement, the character itself if CP1252
 * already covers it, then a compatibility decomposition with combining marks
 * stripped (so `ā` becomes `a` rather than vanishing), and finally the
 * character is dropped.
 *
 * Note that the decomposition step runs *after* the encodable check, so å and
 * ø keep their diacritics — only characters CP1252 genuinely cannot hold get
 * flattened.
 */
export function toWinAnsi(input: string): string {
  let out = "";

  for (const char of input) {
    const replacement = REPLACEMENTS.get(char);
    if (replacement !== undefined) {
      out += replacement;
      continue;
    }

    const codePoint = char.codePointAt(0);
    if (codePoint === undefined) continue;

    if (isWinAnsiEncodable(codePoint)) {
      out += char;
      continue;
    }

    const folded = char
      .normalize("NFKD")
      .replace(/\p{M}/gu, "")
      .split("")
      .filter((c) => {
        const cp = c.codePointAt(0);
        return cp !== undefined && isWinAnsiEncodable(cp);
      })
      .join("");

    out += folded;
  }

  return out;
}
