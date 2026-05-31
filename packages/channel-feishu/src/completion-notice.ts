// B-semantics completion ping: a backgrounded session's streaming card already
// ran to completion in the chat timeline, so this short notice only signals
// "it's done" — it does NOT tell the user to /use to view results (unlike the
// weixin variant, which replays the stored result on switch-back).
export function buildFeishuCompletionNotice(displayAlias: string, status: "done" | "error"): string {
  return status === "done" ? `✅ ${displayAlias} 已完成` : `⚠️ ${displayAlias} 失败`;
}
