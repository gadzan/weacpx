export function buildWorkerTaskPrompt(input: {
  taskId: string;
  workerSession: string;
  role?: string;
  task: string;
}): string {
  return [
    "这是来自 weacpx 的委派任务。",
    `任务 ID: ${input.taskId}`,
    `当前 worker 会话: ${input.workerSession}`,
    ...(input.role ? [`角色: ${input.role}`] : []),
    "请直接完成下面的任务；weacpx 会记录你的最终回复。",
    "如果你因为关键上下文缺失、权限边界或业务决策而无法继续，请不要猜测；调用 worker_raise_question 提交 question / whyBlocked / whatIsNeeded，让 coordinator 决定下一步。",
    "当你完成一个重要步骤时，单独输出一行 [PROGRESS] 加简要进度说明，例如：[PROGRESS] 已完成代码审查。",
    "不需要每个动作都汇报，只在关键里程碑时输出。",
    `任务内容: ${input.task}`,
  ].join("\n");
}

export function buildWorkerAnswerPrompt(answer: string): string {
  return [
    "以下是 coordinator 对你 blocker 的整理后答复，请基于这些明确指令继续当前任务。",
    "不要把原始 human 对话当成上下文来源；只执行下面的答案。",
    "答案：",
    answer,
  ].join("\n");
}
