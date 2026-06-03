import { toDisplaySessionAlias } from "xacpx/plugin-api";
import { t } from "./i18n/index.js";

// A-semantics completion ping for a linear-text channel (the weixin model):
// a backgrounded session's mid-stream output was suppressed and its final
// answer stored, so this short notice tells the user it is ready AND that the
// result is replayed on `/use` switch-back (unlike the feishu card variant,
// whose streaming card already ran to completion in the timeline).
export function buildYuanbaoCompletionNotice(internalAlias: string, status: "done" | "error"): string {
  const display = toDisplaySessionAlias(internalAlias);
  return status === "done" ? t().bgDone(display) : t().bgError(display);
}
