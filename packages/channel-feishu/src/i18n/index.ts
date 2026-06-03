import { getLocale, type Locale } from "xacpx/plugin-api";
import type { FeishuMessages } from "./messages.js";
import { en } from "./en.js";
import { zh } from "./zh.js";

export type { FeishuMessages } from "./messages.js";

// The plugin bundle (plugin-api.js) and the daemon bundle (cli.js) carry
// INDEPENDENT i18n state, so getLocale() in this plugin can never observe the
// daemon's setLocale(config.language). The daemon instead passes the resolved
// locale by VALUE via ChannelStartInput.locale; the channel records it here at
// start(). getLocale() remains only as a best-effort fallback.
let active: Locale | null = null;

/** Called by the channel at start() with ChannelStartInput.locale. */
export function setChannelLocale(locale: Locale): void {
  active = locale;
}

export function t(): FeishuMessages {
  return (active ?? getLocale()) === "zh" ? zh : en;
}
