export interface SanitizeOptions {
  allow?: RegExp;
  deny?: RegExp;
  replacement?: string;
  collapse?: boolean;
  trim?: boolean;
  lowercase?: boolean;
  fallback?: string;
}

export function sanitizeString(input: string, options: SanitizeOptions = {}): string {
  const {
    replacement = "-",
    collapse = false,
    trim = false,
    lowercase = false,
    fallback,
  } = options;

  let result = lowercase ? input.toLowerCase() : input;

  if (options.allow) {
    const pattern = new RegExp(`[^${options.allow.source.slice(1, -1)}]+`, "g");
    result = result.replace(pattern, replacement);
  } else if (options.deny) {
    result = result.replace(options.deny, replacement);
  }

  if (collapse) {
    const escaped = escapeRegExp(replacement);
    result = result.replace(new RegExp(`${escaped}+`, "g"), replacement);
  }

  if (trim) {
    const escaped = escapeRegExp(replacement);
    result = result.replace(new RegExp(`^${escaped}+|${escaped}+$`, "g"), "");
  }

  if (fallback !== undefined && result.length === 0) {
    return fallback;
  }

  return result;
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
