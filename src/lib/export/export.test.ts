// Standalone assert check (no JS unit-test runner in this repo). Run with:
//   bun src/lib/export/export.test.ts
//
// The zip and PDF readers below are deliberately hand-rolled rather than
// pulled from a library: the point of the test is to prove that the bytes we
// hand to the filesystem are a real zip container holding real
// WordprocessingML, and a real PDF holding real selectable text — so decoding
// them with the same libraries that wrote them would prove much less.

import assert from "node:assert";
import { inflateRawSync, inflateSync } from "node:zlib";

import { markdownToBlocks, plainTextToBlocks } from "./markdown";
import { sanitizeFilename, defaultFileName } from "./filename";
import { toWinAnsi, isWinAnsiEncodable } from "./winansi";
import { renderDocx } from "./docx";
import { renderPdf } from "./pdf";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const NORWEGIAN = "Blåbærsyltetøy æøå ÆØÅ";

const MARKDOWN = `# Møtereferat — Åpen høring

Kort **ingress** med *kursiv*, \`kode\` og ${NORWEGIAN}.

## Beslutninger

- Første punkt med **fet** tekst
- Andre punkt om æ, ø og å
  - Nestet punkt med ÆØÅ

### Oppfølging

1. Sende referat til Øystein
2. Avklare rødgrønn måloppnåelse

> Sitat fra møtet: «vi må løse dette før påske»

---

Siste avsnitt.
`;

// ---------------------------------------------------------------------------
// A minimal zip reader (central directory walk + raw inflate)
// ---------------------------------------------------------------------------

const EOCD_SIGNATURE = 0x06054b50;

function findEndOfCentralDirectory(buf: Buffer): number {
  // The EOCD is at the very end, possibly followed by a <=65535 byte comment.
  for (let i = buf.length - 22; i >= 0; i--) {
    if (buf.readUInt32LE(i) === EOCD_SIGNATURE) return i;
  }
  throw new Error("not a zip archive: no end-of-central-directory record");
}

function readZip(bytes: Uint8Array): Map<string, Buffer> {
  const buf = Buffer.from(bytes);
  const eocd = findEndOfCentralDirectory(buf);
  const entryCount = buf.readUInt16LE(eocd + 10);
  let pointer = buf.readUInt32LE(eocd + 16);

  const entries = new Map<string, Buffer>();

  for (let i = 0; i < entryCount; i++) {
    assert.equal(
      buf.readUInt32LE(pointer),
      0x02014b50,
      `bad central directory header for entry ${i}`,
    );

    const method = buf.readUInt16LE(pointer + 10);
    const compressedSize = buf.readUInt32LE(pointer + 20);
    const nameLength = buf.readUInt16LE(pointer + 28);
    const extraLength = buf.readUInt16LE(pointer + 30);
    const commentLength = buf.readUInt16LE(pointer + 32);
    const localOffset = buf.readUInt32LE(pointer + 42);
    const name = buf
      .subarray(pointer + 46, pointer + 46 + nameLength)
      .toString("utf8");

    assert.equal(
      buf.readUInt32LE(localOffset),
      0x04034b50,
      `bad local file header for ${name}`,
    );
    const localNameLength = buf.readUInt16LE(localOffset + 26);
    const localExtraLength = buf.readUInt16LE(localOffset + 28);
    const dataStart = localOffset + 30 + localNameLength + localExtraLength;
    const data = buf.subarray(dataStart, dataStart + compressedSize);

    entries.set(name, method === 0 ? Buffer.from(data) : inflateRawSync(data));

    pointer += 46 + nameLength + extraLength + commentLength;
  }

  return entries;
}

// ---------------------------------------------------------------------------
// A minimal PDF text extractor
// ---------------------------------------------------------------------------

/** The 27 CP1252 code points that differ from Latin-1, indexed from 0x80. */
const CP1252_HIGH_TABLE = "€‚ƒ„…†‡ˆ‰Š‹" + "ŒŽ‘’“”•–—" + "˜™š›œžŸ";

function decodeWinAnsi(bytes: Buffer): string {
  let out = "";
  for (const byte of bytes) {
    out +=
      byte >= 0x80 && byte <= 0x9f
        ? CP1252_HIGH_TABLE[byte - 0x80]
        : String.fromCharCode(byte);
  }
  return out;
}

/** Inflate every FlateDecode stream in the file and concatenate the results. */
function pdfStreams(bytes: Uint8Array): Buffer[] {
  const buf = Buffer.from(bytes);
  const streams: Buffer[] = [];
  const marker = Buffer.from("stream");
  const endMarker = Buffer.from("endstream");

  let index = buf.indexOf(marker, 0);
  while (index !== -1) {
    let start = index + marker.length;
    // Skip the EOL that must follow the `stream` keyword.
    if (buf[start] === 0x0d) start++;
    if (buf[start] === 0x0a) start++;

    const end = buf.indexOf(endMarker, start);
    if (end === -1) break;

    const raw = buf.subarray(start, end);
    try {
      streams.push(inflateSync(raw));
    } catch {
      streams.push(Buffer.from(raw));
    }

    index = buf.indexOf(marker, end + endMarker.length);
  }

  return streams;
}

/**
 * Pull the text out of PDF content streams by reading the arguments of the
 * text-showing operators (`Tj`, `TJ`, `'`, `"`).
 */
function extractPdfText(bytes: Uint8Array): string {
  const pieces: string[] = [];

  for (const stream of pdfStreams(bytes)) {
    let i = 0;
    while (i < stream.length) {
      const byte = stream[i];

      // Literal string: ( ... ) with backslash escapes and nested parens.
      if (byte === 0x28) {
        const chars: number[] = [];
        let depth = 1;
        i++;
        while (i < stream.length && depth > 0) {
          const c = stream[i];
          if (c === 0x5c) {
            const next = stream[i + 1];
            const simple: Record<number, number> = {
              0x6e: 0x0a,
              0x72: 0x0d,
              0x74: 0x09,
              0x62: 0x08,
              0x66: 0x0c,
            };
            if (next in simple) {
              chars.push(simple[next]);
              i += 2;
            } else if (next >= 0x30 && next <= 0x37) {
              // Octal escape, up to three digits.
              let octal = "";
              i++;
              while (
                octal.length < 3 &&
                stream[i] >= 0x30 &&
                stream[i] <= 0x37
              ) {
                octal += String.fromCharCode(stream[i]);
                i++;
              }
              chars.push(parseInt(octal, 8));
            } else {
              chars.push(next);
              i += 2;
            }
            continue;
          }
          if (c === 0x28) depth++;
          if (c === 0x29) {
            depth--;
            if (depth === 0) {
              i++;
              break;
            }
          }
          chars.push(c);
          i++;
        }
        pieces.push(decodeWinAnsi(Buffer.from(chars)));
        continue;
      }

      // Hex string: < ... >
      if (byte === 0x3c && stream[i + 1] !== 0x3c) {
        const close = stream.indexOf(0x3e, i);
        if (close === -1) break;
        const hex = stream
          .subarray(i + 1, close)
          .toString("ascii")
          .replace(/\s+/g, "");
        if (/^[0-9a-fA-F]*$/.test(hex) && hex.length % 2 === 0) {
          pieces.push(decodeWinAnsi(Buffer.from(hex, "hex")));
        }
        i = close + 1;
        continue;
      }

      i++;
    }
  }

  return pieces.join(" ");
}

// ---------------------------------------------------------------------------
// 1. Markdown parsing
// ---------------------------------------------------------------------------

{
  const blocks = markdownToBlocks(MARKDOWN);
  const kinds = blocks.map((b) => b.kind);

  assert.ok(kinds.includes("heading"), "expected headings");
  assert.ok(kinds.includes("listItem"), "expected list items");
  assert.ok(kinds.includes("quote"), "expected a block quote");
  assert.ok(kinds.includes("rule"), "expected a thematic break");

  const h1 = blocks.find((b) => b.kind === "heading" && b.level === 1);
  assert.ok(h1 && h1.kind === "heading");
  assert.equal(
    h1.spans.map((s) => s.text).join(""),
    "Møtereferat — Åpen høring",
  );

  // Bold and italic must survive as span styling, not literal asterisks.
  const intro = blocks.find(
    (b) => b.kind === "paragraph" && b.spans.some((s) => s.bold),
  );
  assert.ok(intro && intro.kind === "paragraph");
  assert.equal(intro.spans.find((s) => s.bold)?.text, "ingress");
  assert.equal(intro.spans.find((s) => s.italic)?.text, "kursiv");
  assert.equal(intro.spans.find((s) => s.code)?.text, "kode");
  assert.ok(
    !intro.spans.some((s) => s.text.includes("**")),
    "markdown emphasis markers leaked into the text",
  );

  // Ordered vs unordered, and nesting depth.
  const ordered = blocks.filter((b) => b.kind === "listItem" && b.ordered);
  assert.equal(ordered.length, 2);
  assert.deepEqual(
    ordered.map((b) => (b.kind === "listItem" ? b.index : -1)),
    [1, 2],
  );

  const nested = blocks.find((b) => b.kind === "listItem" && b.depth === 1);
  assert.ok(nested && nested.kind === "listItem");
  assert.equal(
    nested.spans.map((s) => s.text).join(""),
    "Nestet punkt med ÆØÅ",
  );

  console.log(`markdown: ${blocks.length} blocks — ${kinds.join(", ")}`);
}

// ---------------------------------------------------------------------------
// 2. Plain text must NOT be interpreted as markdown
// ---------------------------------------------------------------------------

{
  const transcript =
    "# ikke en overskrift\n- ikke en liste\n\nAndre avsnitt æøå.";
  const blocks = plainTextToBlocks(transcript);

  assert.equal(blocks.length, 2);
  assert.ok(blocks.every((b) => b.kind === "paragraph"));
  assert.equal(
    blocks[0].kind === "paragraph" ? blocks[0].spans[0].text : "",
    "# ikke en overskrift - ikke en liste",
  );
  assert.equal(
    blocks[1].kind === "paragraph" ? blocks[1].spans[0].text : "",
    "Andre avsnitt æøå.",
  );

  console.log("plain text: hard-wrapped lines joined, markup left literal");
}

// ---------------------------------------------------------------------------
// 3. Filename sanitising
// ---------------------------------------------------------------------------

{
  assert.equal(
    sanitizeFilename("Møte: Q1/2026 <utkast>"),
    "Møte Q1 2026 utkast",
  );
  assert.equal(sanitizeFilename("   "), "export");
  assert.equal(sanitizeFilename("CON"), "export");
  assert.equal(sanitizeFilename("navn."), "navn");
  // Hyphens and spaces are legal and must survive; control characters must not.
  assert.equal(sanitizeFilename("Møte-referat 2026"), "Møte-referat 2026");
  assert.equal(sanitizeFilename("linje brudd\ttab"), "linje brudd tab");
  assert.equal(defaultFileName("Åpen høring", "docx"), "Åpen høring.docx");
  assert.ok(sanitizeFilename("x".repeat(500)).length <= 120);

  console.log("filenames: illegal characters stripped, Norwegian letters kept");
}

// ---------------------------------------------------------------------------
// 4. WinAnsi sanitising
// ---------------------------------------------------------------------------

{
  // Everything Norwegian must pass through untouched.
  assert.equal(toWinAnsi(NORWEGIAN), NORWEGIAN);
  for (const char of "æøåÆØÅ") {
    assert.ok(
      isWinAnsiEncodable(char.codePointAt(0) ?? 0),
      `${char} must be CP1252-encodable`,
    );
  }

  // CP1252 typography survives; non-CP1252 characters are transliterated.
  assert.equal(
    toWinAnsi("«sitat» – tanke — slutt …"),
    "«sitat» – tanke — slutt …",
  );
  assert.equal(toWinAnsi("a → b"), "a -> b");
  assert.equal(toWinAnsi("✓ ferdig"), "v ferdig");
  assert.equal(toWinAnsi("Māori"), "Maori");
  assert.equal(toWinAnsi("ok 🎉"), "ok ");

  console.log("winansi: Norwegian preserved, unsupported glyphs folded");
}

// ---------------------------------------------------------------------------
// 5. DOCX — valid zip container holding valid WordprocessingML
// ---------------------------------------------------------------------------

{
  const blocks = markdownToBlocks(MARKDOWN);
  const bytes = await renderDocx(
    "Møtereferat æøå ÆØÅ",
    "3. mars 2026 · 42 min",
    blocks,
  );

  assert.ok(bytes instanceof Uint8Array);
  assert.equal(bytes[0], 0x50, "docx must start with the PK zip signature");
  assert.equal(bytes[1], 0x4b);

  const entries = readZip(bytes);
  const names = [...entries.keys()].sort();

  for (const required of [
    "[Content_Types].xml",
    "_rels/.rels",
    "word/document.xml",
    "word/numbering.xml",
    "word/styles.xml",
  ]) {
    assert.ok(entries.has(required), `missing zip entry ${required}`);
  }

  const documentXml = entries.get("word/document.xml")!.toString("utf8");

  // Well-formed WordprocessingML in the right namespace.
  assert.ok(
    documentXml.includes(
      'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"',
    ),
    "document.xml is not in the WordprocessingML namespace",
  );
  assert.ok(/<w:document[\s>]/.test(documentXml));
  assert.ok(documentXml.trimEnd().endsWith("</w:document>"));

  // Tag balance — a cheap but effective well-formedness check.
  const opens = documentXml.match(/<w:p(?:\s[^>]*)?>/g) ?? [];
  const closes = documentXml.match(/<\/w:p>/g) ?? [];
  assert.equal(opens.length, closes.length, "unbalanced <w:p> elements");
  assert.ok(opens.length > 8, `expected many paragraphs, got ${opens.length}`);

  // Headings became real Word heading styles, not literal "##".
  assert.ok(
    documentXml.includes('w:val="Heading1"'),
    "no Heading1 style in document.xml",
  );
  assert.ok(documentXml.includes('w:val="Heading2"'));
  assert.ok(documentXml.includes('w:val="Heading3"'));
  assert.ok(
    !documentXml.includes("## Beslutninger"),
    "literal markdown heading syntax leaked into the docx",
  );
  assert.ok(!/&gt;\s*Sitat fra/.test(documentXml));

  // Bold and italic became run properties.
  assert.ok(/<w:b\b/.test(documentXml), "no bold run property");
  assert.ok(/<w:i\b/.test(documentXml), "no italic run property");

  // Lists became numbered paragraphs referencing our numbering definitions.
  assert.ok(/<w:numPr>/.test(documentXml), "no list numbering in document.xml");
  const numberingXml = entries.get("word/numbering.xml")!.toString("utf8");
  assert.ok(numberingXml.includes('w:val="bullet"'), "no bullet list format");
  assert.ok(numberingXml.includes('w:val="decimal"'), "no decimal list format");
  assert.ok(numberingXml.includes('w:val="lowerLetter"'));

  // Norwegian characters, stored as UTF-8 in the XML.
  for (const needle of [
    "Møtereferat",
    "Åpen høring",
    "Blåbærsyltetøy",
    "ÆØÅ",
    "Øystein",
    "rødgrønn måloppnåelse",
    "løse dette før påske",
  ]) {
    assert.ok(
      documentXml.includes(needle),
      `document.xml is missing Norwegian text: ${needle}`,
    );
  }

  console.log(
    `docx: ${bytes.length} bytes, ${names.length} zip entries, ` +
      `${opens.length} paragraphs, Norwegian text intact`,
  );
}

// ---------------------------------------------------------------------------
// 6. PDF — selectable text, correct Norwegian characters
// ---------------------------------------------------------------------------

{
  const blocks = markdownToBlocks(MARKDOWN);
  const bytes = await renderPdf(
    "Møtereferat æøå ÆØÅ",
    "3. mars 2026 · 42 min",
    blocks,
  );

  assert.ok(bytes instanceof Uint8Array);
  assert.equal(
    Buffer.from(bytes.subarray(0, 5)).toString("ascii"),
    "%PDF-",
    "missing PDF header",
  );

  const text = extractPdfText(bytes);

  // Selectable text, not an image: there must be text-showing operators and no
  // embedded raster image.
  const streams = pdfStreams(bytes);
  const content = streams.map((s) => s.toString("latin1")).join("\n");
  assert.ok(
    /\bTj\b|\bTJ\b/.test(content),
    "no text-showing operator in the PDF",
  );
  assert.ok(
    !/\/Subtype\s*\/Image/.test(Buffer.from(bytes).toString("latin1")),
    "PDF contains a raster image — text must not be rasterised",
  );

  for (const needle of [
    "Møtereferat",
    "æøå",
    "ÆØÅ",
    "Åpen",
    "høring",
    "Blåbærsyltetøy",
    "Øystein",
    "rødgrønn",
    "måloppnåelse",
    "påske",
    "Nestet",
    "Beslutninger",
    "Oppfølging",
  ]) {
    assert.ok(
      text.includes(needle),
      `extracted PDF text is missing: ${needle}\n---\n${text.slice(0, 600)}`,
    );
  }

  // Markdown syntax must not survive as literal characters.
  assert.ok(!text.includes("## "), "literal '## ' found in the PDF text");
  assert.ok(!text.includes("**"), "literal '**' found in the PDF text");

  console.log(
    `pdf: ${bytes.length} bytes, ${streams.length} streams, ` +
      `${text.length} characters of extractable text`,
  );
  console.log(`pdf extract (first 240 chars): ${text.slice(0, 240)}`);
}

console.log("\nAll export tests passed.");
