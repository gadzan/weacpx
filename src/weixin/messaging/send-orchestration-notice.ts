import type { OrchestrationTaskRecord } from "../../orchestration/orchestration-types";
import { normalizeWeixinUserIdFromChatKey } from "./inbound.js";
import { sendMessageWeixin } from "./send.js";
import { t } from "../../i18n/index.js";

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
  const workerDisplay = task.workerSession ?? t().misc.workerUnassigned;
  const text =
    task.status === "completed"
      ? t().misc.orchestrationTaskCompleted(task.taskId, workerDisplay, truncate(task.resultText))
      : t().misc.orchestrationTaskFailed(task.taskId, workerDisplay, truncate(task.summary || task.resultText || "unknown error"));

  await sendMessage({
    to: normalizeWeixinUserIdFromChatKey(task.chatKey),
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
