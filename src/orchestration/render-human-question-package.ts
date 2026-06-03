import { t } from "../i18n/index.js";

export interface RenderHumanQuestionPackageMessageInput {
  promptText: string;
  queuedCount: number;
}

export interface RenderHumanQuestionPackageReceiptInput {
  resumed: Array<{ taskId: string; summary: string }>;
  unresolved: Array<{ taskId: string; summary: string }>;
  queuedCount: number;
}

export function renderHumanQuestionPackageMessage(input: RenderHumanQuestionPackageMessageInput): string {
  if (input.queuedCount <= 0) {
    return input.promptText;
  }

  return `${input.promptText}${t().misc.humanQuestionQueued(input.queuedCount)}`;
}

export function renderHumanQuestionPackageReceipt(input: RenderHumanQuestionPackageReceiptInput): string {
  const lines: string[] = [];

  for (const item of input.resumed) {
    lines.push(t().misc.humanQuestionResumed(item.taskId, item.summary));
  }

  for (const item of input.unresolved) {
    lines.push(t().misc.humanQuestionUnresolved(item.taskId, item.summary));
  }

  if (input.queuedCount > 0) {
    lines.push(t().misc.humanQuestionQueuedLine(input.queuedCount));
  }

  return lines.join("\n");
}
