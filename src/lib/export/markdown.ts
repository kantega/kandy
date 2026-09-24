/**
 * Markdown (and plain text) to {@link Block} conversion.
 *
 * Parsing uses `mdast-util-from-markdown`, which is the same CommonMark parser
 * that `react-markdown` already runs on the meeting page (via `remark-parse`).
 * Reusing it means an exported summary is structured exactly the way the user
 * saw it on screen, and it costs nothing extra in the bundle because the module
 * is already in the graph.
 */

import { fromMarkdown } from "mdast-util-from-markdown";
import type {
  Blockquote,
  Heading,
  List,
  ListItem,
  Paragraph,
  PhrasingContent,
  Root,
  RootContent,
} from "mdast";
import type { Block, HeadingLevel, InlineSpan } from "./types";
import { plainSpan } from "./types";

interface SpanStyle {
  bold: boolean;
  italic: boolean;
}

const NO_STYLE: SpanStyle = { bold: false, italic: false };

/**
 * Flatten mdast phrasing content into styled spans.
 *
 * Anything we do not have a dedicated representation for (links, images,
 * strikethrough, ...) degrades to its text content rather than disappearing.
 */
function collectSpans(
  nodes: readonly PhrasingContent[],
  style: SpanStyle = NO_STYLE,
): InlineSpan[] {
  const spans: InlineSpan[] = [];

  for (const node of nodes) {
    switch (node.type) {
      case "text":
        spans.push({ text: node.value, ...style, code: false });
        break;
      case "inlineCode":
        spans.push({ text: node.value, ...style, code: true });
        break;
      case "strong":
        spans.push(...collectSpans(node.children, { ...style, bold: true }));
        break;
      case "emphasis":
        spans.push(...collectSpans(node.children, { ...style, italic: true }));
        break;
      case "break":
        spans.push({ text: " ", ...style, code: false });
        break;
      case "delete":
      case "link":
      case "linkReference":
        spans.push(...collectSpans(node.children, style));
        break;
      case "image":
        // No image support in the export; keep the alt text so the reader is
        // not left with a silent gap.
        if (node.alt) spans.push({ text: node.alt, ...style, code: false });
        break;
      default:
        break;
    }
  }

  return mergeAdjacent(spans);
}

/** Merge neighbouring spans that share styling, so writers emit fewer runs. */
function mergeAdjacent(spans: readonly InlineSpan[]): InlineSpan[] {
  const merged: InlineSpan[] = [];

  for (const span of spans) {
    if (span.text === "") continue;
    const previous = merged[merged.length - 1];
    if (
      previous &&
      previous.bold === span.bold &&
      previous.italic === span.italic &&
      previous.code === span.code
    ) {
      previous.text += span.text;
    } else {
      merged.push({ ...span });
    }
  }

  return merged;
}

function clampHeadingLevel(depth: number): HeadingLevel {
  if (depth <= 1) return 1;
  if (depth >= 6) return 6;
  return depth as HeadingLevel;
}

/** Text content of a block node, used where only flat text makes sense. */
function blockText(node: RootContent): string {
  if ("value" in node && typeof node.value === "string") return node.value;
  if ("children" in node) {
    return (node.children as RootContent[]).map(blockText).join("");
  }
  return "";
}

function convertList(list: List, depth: number, out: Block[]): void {
  const ordered = list.ordered === true;
  const start = typeof list.start === "number" ? list.start : 1;

  list.children.forEach((item: ListItem, position) => {
    const [first, ...rest] = item.children;
    const leadSpans =
      first && first.type === "paragraph"
        ? collectSpans((first as Paragraph).children)
        : [];

    out.push({
      kind: "listItem",
      ordered,
      depth,
      index: start + position,
      spans: leadSpans,
    });

    // A list item's first paragraph becomes the bullet line itself; everything
    // after it (extra paragraphs, nested lists) is emitted as indented blocks.
    const tail = first && first.type === "paragraph" ? rest : item.children;
    for (const child of tail) {
      convertNode(child, depth + 1, out);
    }
  });
}

function convertNode(node: RootContent, depth: number, out: Block[]): void {
  switch (node.type) {
    case "heading":
      out.push({
        kind: "heading",
        level: clampHeadingLevel((node as Heading).depth),
        spans: collectSpans((node as Heading).children),
      });
      break;

    case "paragraph":
      out.push({
        kind: "paragraph",
        depth,
        spans: collectSpans((node as Paragraph).children),
      });
      break;

    case "list":
      convertList(node as List, depth, out);
      break;

    case "blockquote":
      for (const child of (node as Blockquote).children) {
        if (child.type === "paragraph") {
          out.push({
            kind: "quote",
            depth,
            spans: collectSpans(child.children),
          });
        } else {
          convertNode(child, depth, out);
        }
      }
      break;

    case "code":
      out.push({ kind: "code", text: node.value });
      break;

    case "thematicBreak":
      out.push({ kind: "rule" });
      break;

    case "html": {
      // Raw HTML is not rendered; fall back to its literal text so nothing is
      // silently dropped from the export.
      const text = node.value.trim();
      if (text)
        out.push({ kind: "paragraph", depth, spans: [plainSpan(text)] });
      break;
    }

    default: {
      const text = blockText(node).trim();
      if (text)
        out.push({ kind: "paragraph", depth, spans: [plainSpan(text)] });
      break;
    }
  }
}

/** Parse a CommonMark string into the format-agnostic block model. */
export function markdownToBlocks(markdown: string): Block[] {
  const tree: Root = fromMarkdown(markdown);
  const blocks: Block[] = [];
  for (const node of tree.children) {
    convertNode(node, 0, blocks);
  }
  return blocks;
}

/**
 * Turn plain text into paragraphs without interpreting any markup.
 *
 * Blank lines separate paragraphs. Single newlines inside a paragraph are
 * treated as soft wraps and collapsed to spaces, which is what transcripts
 * (hard-wrapped by the recogniser) want.
 */
export function plainTextToBlocks(text: string): Block[] {
  return text
    .replace(/\r\n?/g, "\n")
    .split(/\n{2,}/)
    .map((paragraph) => paragraph.split("\n").join(" ").trim())
    .filter((paragraph) => paragraph.length > 0)
    .map((paragraph) => ({
      kind: "paragraph" as const,
      depth: 0,
      spans: [plainSpan(paragraph)],
    }));
}

/** Dispatch to the right parser for an {@link ExportDoc} body. */
export function bodyToBlocks(
  body: string,
  format: "markdown" | "text" = "markdown",
): Block[] {
  return format === "text" ? plainTextToBlocks(body) : markdownToBlocks(body);
}
