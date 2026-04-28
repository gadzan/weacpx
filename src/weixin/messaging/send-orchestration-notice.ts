import type { OrchestrationTaskRecord } from "../../orchestration/orchestration-types";
import { sendMessageWeixin } from "./send.js";

interface NoticeDeps {
  baseUrl: string;
  token?: string;
  contextToken: string;
  sendMessage?: typeof sendMessageWeixin;
}

export async function sendOrchestrationTaskNotice(
  task: OrchestrationTaskRecord,
  deps: NoticeDeps,
): Promise<void> {
  if (!task.chatKey) {
    return;
  }

  if (task.status !== "completed" && task.status !== "failed") {
    return;
  }

  const sendMessage = deps.sendMessage ?? sendMessageWeixin;
  const text =
    task.status === "completed"
      ? [
          `委派任务「${task.taskId}」已完成`,
          `- worker：${task.workerSession ?? "未分配"}`,
          `- 结果：${truncate(task.resultText)}`,
        ].join("\n")
      : [
          `委派任务「${task.taskId}」执行失败`,
          `- worker：${task.workerSession ?? "未分配"}`,
          `- 原因：${truncate(task.summary || task.resultText || "unknown error")}`,
        ].join("\n");

  await sendMessage({
    to: task.chatKey,
    text,
    opts: {
      baseUrl: deps.baseUrl,
      token: deps.token,
      contextToken: deps.contextToken,
    },
  });
}

function truncate(text: string, max = 1000): string {
  const normalized = text.trim();
  if (normalized.length <= max) {
    return normalized;
  }

  return `${normalized.slice(0, max - 3)}...`;
}
