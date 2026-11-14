/** Quote CSV text and neutralize spreadsheet formulas, including whitespace-prefixed payloads. */
export function csvCell(value: unknown): string {
  const text = String(value ?? "");
  const safe = /^[\s=+@-]/.test(text) ? "'" + text : text;
  return '"' + safe.replaceAll('"', '""') + '"';
}
