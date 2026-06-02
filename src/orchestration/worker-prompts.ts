import { t } from "../i18n";

export function buildWorkerTaskPrompt(input: {
  taskId: string;
  workerSession: string;
  role?: string;
  task: string;
}): string {
  return [
    t().workerPrompt.taskHeader,
    t().workerPrompt.taskIdLabel(input.taskId),
    t().workerPrompt.taskWorkerSessionLabel(input.workerSession),
    ...(input.role ? [t().workerPrompt.taskRoleLabel(input.role)] : []),
    t().workerPrompt.taskInstruction,
    t().workerPrompt.taskBlockerInstruction,
    t().workerPrompt.taskProgressInstruction,
    t().workerPrompt.taskProgressNote,
    t().workerPrompt.taskContentLabel(input.task),
  ].join("\n");
}

export function buildWorkerAnswerPrompt(answer: string): string {
  return [
    t().workerPrompt.answerHeader,
    t().workerPrompt.answerInstruction,
    t().workerPrompt.answerLabel,
    answer,
  ].join("\n");
}
