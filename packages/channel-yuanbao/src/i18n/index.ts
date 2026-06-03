import { getLocale } from "xacpx/plugin-api";
import type { YuanbaoMessages } from "./messages.js";
import { en } from "./en.js";
import { zh } from "./zh.js";

export type { YuanbaoMessages } from "./messages.js";

export function t(): YuanbaoMessages {
  return getLocale() === "zh" ? zh : en;
}
