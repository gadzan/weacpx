/**
 * User-facing bilingual strings for the Feishu channel.
 *
 * Card summaries already use Feishu's `i18n_content` resource bundles (see
 * card-builder.ts); this module covers the strings that go through plain
 * text replies (abort ack, error footnotes, permission notices) so they can
 * be localized consistently later. For now everything resolves to `zh_cn`
 * because no caller threads a locale through — but the indirection means a
 * future per-account locale setting can land without touching every call
 * site.
 */

export type Locale = "zh_cn" | "en_us";

const DEFAULT_LOCALE: Locale = "zh_cn";

interface Bundle {
  abortAck: string;
  errorFootnote: (tail: string) => string;
  permissionScopeMissing: (scopes: string) => string;
  permissionPromptToGrant: string;
  permissionGenericScopeHint: string;
}

const BUNDLES: Record<Locale, Bundle> = {
  zh_cn: {
    abortAck: "已停止当前任务。",
    errorFootnote: (tail) => `_错误:${tail}_`,
    permissionScopeMissing: (scopes) => `缺少权限:${scopes}`,
    permissionPromptToGrant: "请管理员点击下方链接授权后重试:",
    permissionGenericScopeHint: "机器人缺少 Feishu API 权限",
  },
  en_us: {
    abortAck: "Stopped current task.",
    errorFootnote: (tail) => `_Error: ${tail}_`,
    permissionScopeMissing: (scopes) => `Missing scopes: ${scopes}`,
    permissionPromptToGrant: "Ask an admin to authorize via the link below, then retry:",
    permissionGenericScopeHint: "The bot is missing required Feishu API scopes",
  },
};

function bundle(locale: Locale = DEFAULT_LOCALE): Bundle {
  return BUNDLES[locale] ?? BUNDLES[DEFAULT_LOCALE];
}

export function abortAck(locale?: Locale): string {
  return bundle(locale).abortAck;
}

export function formatErrorFootnote(tail: string, locale?: Locale): string {
  return bundle(locale).errorFootnote(tail);
}

export function permissionScopeMissing(scopes: string, locale?: Locale): string {
  return scopes
    ? bundle(locale).permissionScopeMissing(scopes)
    : bundle(locale).permissionGenericScopeHint;
}

export function permissionPromptToGrant(locale?: Locale): string {
  return bundle(locale).permissionPromptToGrant;
}
