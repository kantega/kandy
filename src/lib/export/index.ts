/**
 * Document export.
 *
 * Turns a {@link ExportDoc} — a title, an optional subtitle and a markdown or
 * plain-text body — into a Word or PDF file, and optionally writes it to a
 * location the user picks.
 *
 * The two writers (`docx`, `pdf-lib`) are heavy and only needed when someone
 * actually exports, so they are behind dynamic `import()` inside
 * {@link exportToDocx} and {@link exportToPdf}. Nothing in this module's own
 * import graph pulls them in, which keeps them out of the main chunk.
 *
 * @example
 * ```ts
 * const result = await saveExport(
 *   { title: "Møtereferat", subtitle: "3. mars 2026 · 42 min", markdown: summary },
 *   "pdf",
 * );
 * if (result.saved) toast.success(t("export.saved"));
 * ```
 */

import { bodyToBlocks } from "./markdown";
import { defaultFileName } from "./filename";
import type { ExportDoc, ExportFormat } from "./types";

export type { ExportDoc, ExportFormat } from "./types";
export { sanitizeFilename } from "./filename";

/** Outcome of {@link saveExport}. `saved: false` means the user cancelled. */
export type SaveExportResult = { saved: true; path: string } | { saved: false };

interface FormatSpec {
  extension: string;
  /** Label shown in the save dialog's file-type filter. */
  filterName: string;
  mimeType: string;
}

export const EXPORT_FORMATS: Record<ExportFormat, FormatSpec> = {
  docx: {
    extension: "docx",
    filterName: "Word",
    mimeType:
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  },
  pdf: {
    extension: "pdf",
    filterName: "PDF",
    mimeType: "application/pdf",
  },
};

/** Render a document to Word (.docx) bytes. */
export async function exportToDocx(doc: ExportDoc): Promise<Uint8Array> {
  const { renderDocx } = await import("./docx");
  const blocks = bodyToBlocks(doc.markdown, doc.bodyFormat);
  return renderDocx(doc.title, doc.subtitle, blocks);
}

/** Render a document to PDF bytes, with selectable (not rasterised) text. */
export async function exportToPdf(doc: ExportDoc): Promise<Uint8Array> {
  const { renderPdf } = await import("./pdf");
  const blocks = bodyToBlocks(doc.markdown, doc.bodyFormat);
  return renderPdf(doc.title, doc.subtitle, blocks);
}

/** Render a document to bytes in the requested format. */
export function exportToBytes(
  doc: ExportDoc,
  format: ExportFormat,
): Promise<Uint8Array> {
  return format === "docx" ? exportToDocx(doc) : exportToPdf(doc);
}

/**
 * Render a document, ask the user where to put it, and write it there.
 *
 * Resolves with `{ saved: false }` if the save dialog was dismissed. Rendering
 * and write failures reject, so callers should wrap this in try/catch and
 * surface the error.
 *
 * The path returned by the dialog plugin is added to the filesystem scope by
 * the plugin itself, so no static `fs:scope` entry is needed for the
 * destination — only the `fs:allow-write-file` command permission, which is
 * granted in `src-tauri/capabilities/default.json`.
 */
export async function saveExport(
  doc: ExportDoc,
  format: ExportFormat,
): Promise<SaveExportResult> {
  const spec = EXPORT_FORMATS[format];

  const [{ save }, { writeFile }] = await Promise.all([
    import("@tauri-apps/plugin-dialog"),
    import("@tauri-apps/plugin-fs"),
  ]);

  const path = await save({
    defaultPath: defaultFileName(doc.title, spec.extension),
    filters: [{ name: spec.filterName, extensions: [spec.extension] }],
  });

  if (path === null) return { saved: false };

  const bytes = await exportToBytes(doc, format);
  await writeFile(path, bytes);

  return { saved: true, path };
}
