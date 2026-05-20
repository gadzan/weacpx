const VALID_WORKSPACE_NAME_RE = /^[a-zA-Z0-9._-]+$/;
const UNSAFE_RUN_RE = /[^a-zA-Z0-9._-]+/g;
const TRIM_DASHES_RE = /^-+|-+$/g;

export function sanitizeWorkspaceName(input: string, fallback = "workspace"): string {
  const sanitized = input.trim().replace(UNSAFE_RUN_RE, "-").replace(TRIM_DASHES_RE, "");
  return sanitized.length > 0 ? sanitized : fallback;
}

export function allocateWorkspaceName(base: string, existing: Record<string, unknown>): string {
  if (!Object.prototype.hasOwnProperty.call(existing, base)) return base;
  let suffix = 2;
  while (Object.prototype.hasOwnProperty.call(existing, `${base}-${suffix}`)) suffix += 1;
  return `${base}-${suffix}`;
}

export function isWorkspaceNameValid(input: string): boolean {
  return VALID_WORKSPACE_NAME_RE.test(input);
}

export function quoteWorkspaceNameIfNeeded(input: string): string {
  if (isWorkspaceNameValid(input)) return input;
  return `"${input.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
}
