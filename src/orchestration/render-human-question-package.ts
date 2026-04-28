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

  return `${input.promptText}\n\n（另外还有 ${input.queuedCount} 个新问题已排队，等这一轮处理完再继续。）`;
}

export function renderHumanQuestionPackageReceipt(input: RenderHumanQuestionPackageReceiptInput): string {
  const lines: string[] = [];

  for (const item of input.resumed) {
    lines.push(`${item.taskId}：已恢复（${item.summary}）`);
  }

  for (const item of input.unresolved) {
    lines.push(`${item.taskId}：仍待补充（${item.summary}）`);
  }

  if (input.queuedCount > 0) {
    lines.push(`还有 ${input.queuedCount} 个新问题已排队，等这一轮处理完再继续。`);
  }

  return lines.join("\n");
}
