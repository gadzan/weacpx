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
