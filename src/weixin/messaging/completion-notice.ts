import { toDisplaySessionAlias } from "../../channels/channel-scope.js";

// Short line sent to the foreground chat when a backgrounded session finishes,
// so the user knows it is ready without dumping the full result. The result
// itself is replayed only on /use switch-back.
export function buildBackgroundCompletionNotice(internalAlias: string, status: "done" | "error"): string {
  const display = toDisplaySessionAlias(internalAlias);
  return status === "done"
    ? `✅ ${display} 已完成，/use ${display} 查看结果`
    : `⚠️ ${display} 失败，/use ${display} 查看详情`;
}

// Decide whether a background completion notice may be sent: it consumes one
// final-quota slot for the chat. `reserve` is the chat's reserveFinal bound to
// the recipient (returns true when a slot was reserved). When no reserver is
// configured (legacy callers) the notice always sends.
export function shouldSendBackgroundNotice(reserve: (() => boolean) | undefined): boolean {
  return reserve ? reserve() : true;
}
