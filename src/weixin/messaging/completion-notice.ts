import { toDisplaySessionAlias } from "../../channels/channel-scope.js";
import { t } from "../../i18n/index.js";

// Short line sent to the foreground chat when a backgrounded session finishes,
// so the user knows it is ready without dumping the full result. The result
// itself is replayed only on /use switch-back.
export function buildBackgroundCompletionNotice(internalAlias: string, status: "done" | "error"): string {
  const display = toDisplaySessionAlias(internalAlias);
  return status === "done"
    ? t().misc.bgSessionDone(display)
    : t().misc.bgSessionError(display);
}

// Decide whether a background completion notice may be sent: it consumes one
// final-quota slot for the chat. `reserve` is the chat's reserveFinal bound to
// the recipient (returns true when a slot was reserved). When no reserver is
// configured (legacy callers) the notice always sends.
export function shouldSendBackgroundNotice(reserve: (() => boolean) | undefined): boolean {
  return reserve ? reserve() : true;
}
