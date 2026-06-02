export type Locale = "en" | "zh";

const VALID = ["en", "zh"] as const;

export function isLocale(value: unknown): value is Locale {
  return typeof value === "string" && (VALID as readonly string[]).includes(value);
}

export function resolveLocale(
  input: { configLanguage?: string; env?: NodeJS.ProcessEnv } = {},
): Locale {
  const { configLanguage, env = process.env } = input;
  if (isLocale(configLanguage)) return configLanguage;
  const raw = env.LC_ALL || env.LC_MESSAGES || env.LANG || "";
  return /^zh/i.test(raw) ? "zh" : "en";
}
