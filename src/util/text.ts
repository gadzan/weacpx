export function truncateText(text: string, maxLength: number, ellipsis = "…"): string {
  if (text.length <= maxLength) return text;
  return text.slice(0, maxLength - ellipsis.length) + ellipsis;
}

export function escapeForDoubleQuotes(input: string): string {
  return input.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
}

export function quoteIfNeeded(input: string): string {
  return `"${escapeForDoubleQuotes(input)}"`;
}
