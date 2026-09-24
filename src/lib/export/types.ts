/**
 * Shared types for the export pipeline.
 *
 * The pipeline is deliberately split in two halves so that the .docx and PDF
 * writers never touch markdown directly:
 *
 *   ExportDoc --(markdown.ts)--> Block[] --(docx.ts | pdf.ts)--> Uint8Array
 *
 * `Block[]` is a flat, format-agnostic list. Flattening nested lists into a
 * `depth` field (rather than keeping a tree) keeps both writers simple: docx
 * wants a flat run of paragraphs with indentation levels anyway, and the PDF
 * writer lays out one block at a time down the page.
 */

/** How the body of an {@link ExportDoc} should be interpreted. */
export type ExportBodyFormat = "markdown" | "text";

/** Output file formats offered to the user. */
export type ExportFormat = "docx" | "pdf";

/** A document to export. Produced by the calling page, consumed by the writers. */
export interface ExportDoc {
  /** Document heading, also the basis for the default filename. */
  title: string;
  /** Optional line under the title, e.g. a formatted date and duration. */
  subtitle?: string;
  /**
   * The body content.
   *
   * Parsed as CommonMark by default — use this for LLM-generated summaries.
   * Set {@link ExportDoc.bodyFormat} to `"text"` for verbatim transcripts, so
   * that stray `#`, `-` or `*` characters in the transcript are not silently
   * reinterpreted as markup.
   */
  markdown: string;
  /** Defaults to `"markdown"`. */
  bodyFormat?: ExportBodyFormat;
}

/** A styled run of text inside a block. */
export interface InlineSpan {
  text: string;
  bold: boolean;
  italic: boolean;
  /** Rendered in a monospace face. */
  code: boolean;
}

export type HeadingLevel = 1 | 2 | 3 | 4 | 5 | 6;

/** A paragraph of flowing text. */
export interface ParagraphBlock {
  kind: "paragraph";
  spans: InlineSpan[];
  /** Indentation level, used for continuation paragraphs inside list items. */
  depth: number;
}

/** A section heading. */
export interface HeadingBlock {
  kind: "heading";
  level: HeadingLevel;
  spans: InlineSpan[];
}

/** A single bullet or numbered list entry. */
export interface ListItemBlock {
  kind: "listItem";
  ordered: boolean;
  /** Zero-based nesting level. */
  depth: number;
  /** 1-based position within its own list, used to render ordered markers. */
  index: number;
  spans: InlineSpan[];
}

/** A block quote. */
export interface QuoteBlock {
  kind: "quote";
  spans: InlineSpan[];
  depth: number;
}

/** A fenced or indented code block. Rendered verbatim, monospace. */
export interface CodeBlock {
  kind: "code";
  text: string;
}

/** A thematic break (`---`). */
export interface RuleBlock {
  kind: "rule";
}

export type Block =
  | ParagraphBlock
  | HeadingBlock
  | ListItemBlock
  | QuoteBlock
  | CodeBlock
  | RuleBlock;

/** Convenience constructor for an unstyled span. */
export function plainSpan(text: string): InlineSpan {
  return { text, bold: false, italic: false, code: false };
}
