import type { Locale } from "./resolve-locale";
import type { Messages } from "./types";
import { en } from "./messages/en";
import { zh } from "./messages/zh";

export type { Locale } from "./resolve-locale";
export { resolveLocale, isLocale } from "./resolve-locale";
export type { Messages } from "./types";

const LOCALE_MAP: Record<Locale, Messages> = { en, zh };

let active: Messages = en;
let activeLocale: Locale = "en";

export function setLocale(locale: Locale): void {
  activeLocale = locale;
  active = LOCALE_MAP[locale];
}

export function getLocale(): Locale {
  return activeLocale;
}

export function t(): Messages {
  return active;
}
