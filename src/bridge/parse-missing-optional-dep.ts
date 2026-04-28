const PATTERN = /You can try manually installing ["']([^"']+)["']/;
const VALID_NAME = /^(@[a-z0-9][a-z0-9._-]*\/)?[a-z0-9][a-z0-9._-]*$/;

export interface ParsedMissingOptionalDep {
  package: string;
}

export function parseMissingOptionalDep(text: string): ParsedMissingOptionalDep | null {
  const match = PATTERN.exec(text);
  if (!match || !match[1]) return null;
  const pkg = match[1];
  if (!VALID_NAME.test(pkg)) return null;
  return { package: pkg };
}
