/**
 * Minimal RFC-4180-style CSV helpers shared by the admin console exports.
 *
 * Cells are separated by commas and rows by CRLF. The output always begins
 * with a UTF-8 BOM so spreadsheet applications detect the encoding for
 * non-ASCII names and notes.
 */

const FORMULA_TRIGGERS = ["=", "+", "-", "@", "\t", "\r"];

/** Render a single cell. String values that could be interpreted as
 *  spreadsheet formulas (leading = + - @ tab CR) are neutralised with an
 *  apostrophe prefix; numbers are rendered verbatim because they are
 *  system-generated values, never attacker-controlled text. */
export function csvEscape(value: unknown): string {
  if (value === null || value === undefined) return "";
  if (typeof value !== "string") return String(value);
  let text = value;
  if (text.length > 0 && FORMULA_TRIGGERS.includes(text[0])) text = `'${text}`;
  if (/[",\n\r]/.test(text)) text = `"${text.replace(/"/g, '""')}"`;
  return text;
}

/** Build a complete UTF-8 CSV document (with BOM) from headers and rows. */
export function toCsv(headers: readonly string[], rows: ReadonlyArray<ReadonlyArray<unknown>>): string {
  const lines = [headers.map(csvEscape).join(",")];
  for (const row of rows) lines.push(row.map(csvEscape).join(","));
  return `\uFEFF${lines.join("\r\n")}`;
}

/** Trigger a client-side download of a CSV file from the browser. */
export function downloadCsv(filename: string, csv: string): void {
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
}

/** Local-date stamp (YYYY-MM-DD) used in export filenames. */
export function todayStamp(date: Date = new Date()): string {
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${date.getFullYear()}-${month}-${day}`;
}
