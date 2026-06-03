import { getLocale, type Locale } from "xacpx/plugin-api";
import type { YuanbaoMessages } from "./messages.js";
import { en } from "./en.js";
import { zh } from "./zh.js";

export type { YuanbaoMessages } from "./messages.js";

let active: Locale | null = null;

/** Called by the channel at start() with ChannelStartInput.locale. */
export function setChannelLocale(locale: Locale): void {
  active = locale;
}

export function t(): YuanbaoMessages {
  return (active ?? getLocale()) === "zh" ? zh : en;
}
