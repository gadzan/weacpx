export type Locale = "en" | "zh";

const VALID = ["en", "zh"] as const;

export function isLocale(value: unknown): value is Locale {
  return typeof value === "string" && (VALID as readonly string[]).includes(value);
}

/**
 * Best-effort cross-platform system locale (e.g. "zh-CN", "en-US").
 *
 * On Unix/macOS the POSIX env vars below are the source of truth, but on
 * Windows those are unset by default — there the OS locale is only reachable
 * via the system API, which `Intl` queries for us. Even a small-icu Node build
 * still returns the OS locale *name* here (it only lacks formatting data), and
 * a name is all we need for detection.
 */
function detectSystemLocale(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().locale || "";
  } catch {
    return "";
  }
}

export function resolveLocale(
  input: { configLanguage?: string; env?: NodeJS.ProcessEnv; systemLocale?: string } = {},
): Locale {
  const { configLanguage, env = process.env } = input;
  if (isLocale(configLanguage)) return configLanguage;

  // POSIX env (Unix/macOS, or a user who explicitly exported LANG on Windows).
  const raw = env.LC_ALL || env.LC_MESSAGES || env.LANG || "";
  if (raw) return /^zh/i.test(raw) ? "zh" : "en";

  // Fallback: cross-platform system locale. This is what makes auto-detection
  // work on Windows, where the POSIX vars above are absent.
  const systemLocale = input.systemLocale ?? detectSystemLocale();
  return /^zh/i.test(systemLocale) ? "zh" : "en";
}
