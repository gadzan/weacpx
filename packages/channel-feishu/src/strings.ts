/**
 * Thin re-export shim. The bilingual catalog has moved to src/i18n/.
 * All previous call sites now use t() from "../i18n" directly;
 * this file is retained only to avoid breaking any external consumers
 * that may import from it directly.
 *
 * @deprecated Import from "../i18n" instead.
 */

export { t } from "./i18n/index.js";

// Re-export the named helpers that were used by internal call sites so that
// any remaining direct imports continue to compile.
import { t } from "./i18n/index.js";

export function abortAck(): string {
  return t().abortAck;
}

export function formatErrorFootnote(tail: string): string {
  return t().errorFootnote(tail);
}

export function permissionScopeMissing(scopes: string): string {
  return scopes ? t().permissionScopeMissing(scopes) : t().permissionGenericScopeHint;
}

export function permissionPromptToGrant(): string {
  return t().permissionPromptToGrant;
}
