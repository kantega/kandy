/**
 * Punctuation Windows forbids in a file name, plus the POSIX separator.
 *
 * Hyphens, spaces and Norwegian letters are all legal in file names and are
 * deliberately kept. Control characters are stripped separately in
 * {@link sanitizeFilename} — expressing them as a regex range means embedding
 * raw C0 bytes in this source file, which is worth avoiding.
 */
const ILLEGAL_PUNCTUATION = /[<>:"/\\|?*]/g;

/** Lowest code point allowed through; everything below is a C0 control. */
const FIRST_PRINTABLE = 0x20;

/** Device names Windows refuses to use as a file name, with or without suffix. */
const RESERVED = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])$/i;

const MAX_LENGTH = 120;

/** Replace C0 controls (and DEL) with spaces. */
function stripControlCharacters(input: string): string {
  let out = "";
  for (const char of input) {
    const code = char.codePointAt(0) ?? 0;
    out += code < FIRST_PRINTABLE || code === 0x7f ? " " : char;
  }
  return out;
}

/**
 * Derive a safe file name stem from a document title.
 *
 * Norwegian letters are kept — every filesystem the app targets stores names as
 * Unicode, so there is no reason to mangle "Møtereferat" into "M_tereferat".
 */
export function sanitizeFilename(title: string, fallback = "export"): string {
  let name = stripControlCharacters(title.normalize("NFC"))
    .replace(ILLEGAL_PUNCTUATION, " ")
    // Collapse whitespace runs so titles with newlines do not produce gaps.
    .replace(/\s+/g, " ")
    .trim()
    // Windows silently drops trailing dots and spaces; do it ourselves so the
    // name shown in the save dialog is the name that lands on disk.
    .replace(/[. ]+$/, "");

  if (name.length > MAX_LENGTH) {
    name = name.slice(0, MAX_LENGTH).replace(/[. ]+$/, "");
  }

  if (name === "" || RESERVED.test(name)) return fallback;

  return name;
}

/** Full default file name shown in the save dialog, e.g. `Møtereferat.docx`. */
export function defaultFileName(title: string, extension: string): string {
  return `${sanitizeFilename(title)}.${extension}`;
}
