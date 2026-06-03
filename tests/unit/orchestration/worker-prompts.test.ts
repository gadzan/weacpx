import { expect, test, beforeEach } from "bun:test";
import { setLocale, t } from "../../../src/i18n";
import { buildWorkerTaskPrompt, buildWorkerAnswerPrompt } from "../../../src/orchestration/worker-prompts";

beforeEach(() => {
  setLocale("zh");
});

test("buildWorkerTaskPrompt includes all required fields using zh catalog", () => {
  const result = buildWorkerTaskPrompt({
    taskId: "task-abc",
    workerSession: "worker:claude:1",
    task: "Write a unit test for the login module.",
  });

  expect(result).toContain(t().workerPrompt.taskHeader);
  expect(result).toContain(t().workerPrompt.taskIdLabel("task-abc"));
  expect(result).toContain(t().workerPrompt.taskWorkerSessionLabel("worker:claude:1"));
  expect(result).toContain(t().workerPrompt.taskInstruction);
  expect(result).toContain(t().workerPrompt.taskBlockerInstruction);
  expect(result).toContain(t().workerPrompt.taskProgressInstruction);
  expect(result).toContain(t().workerPrompt.taskProgressNote);
  expect(result).toContain(t().workerPrompt.taskContentLabel("Write a unit test for the login module."));
  // role not provided — role line must be absent
  expect(result).not.toContain("角色:");
});

test("buildWorkerTaskPrompt includes role line when role is provided", () => {
  const result = buildWorkerTaskPrompt({
    taskId: "task-xyz",
    workerSession: "worker:claude:2",
    role: "senior-reviewer",
    task: "Review the PR diff.",
  });

  expect(result).toContain(t().workerPrompt.taskRoleLabel("senior-reviewer"));
});

test("buildWorkerTaskPrompt omits role line when role is undefined", () => {
  const result = buildWorkerTaskPrompt({
    taskId: "task-xyz",
    workerSession: "worker:claude:2",
    task: "Review the PR diff.",
  });

  // The role label for zh is "角色: ..." — must not appear when role is absent
  expect(result).not.toContain(t().workerPrompt.taskRoleLabel(""));
  const lines = result.split("\n");
  expect(lines.some((l) => l.startsWith("角色:"))).toBe(false);
});

test("buildWorkerAnswerPrompt includes all required fields using zh catalog", () => {
  const answer = "Use SQLite for the database.";
  const result = buildWorkerAnswerPrompt(answer);

  expect(result).toContain(t().workerPrompt.answerHeader);
  expect(result).toContain(t().workerPrompt.answerInstruction);
  expect(result).toContain(t().workerPrompt.answerLabel);
  expect(result).toContain(answer);
});

test("buildWorkerTaskPrompt produces correct zh output byte-for-byte for known input", () => {
  const result = buildWorkerTaskPrompt({
    taskId: "t-1",
    workerSession: "worker:s1",
    role: "dev",
    task: "do it",
  });

  const expected = [
    "这是来自 xacpx 的委派任务。",
    "任务 ID: t-1",
    "当前 worker 会话: worker:s1",
    "角色: dev",
    "请直接完成下面的任务；xacpx 会记录你的最终回复。",
    "如果你因为关键上下文缺失、权限边界或业务决策而无法继续，请不要猜测；调用 worker_raise_question 提交 question / whyBlocked / whatIsNeeded，让 coordinator 决定下一步。",
    "当你完成一个重要步骤时，单独输出一行 [PROGRESS] 加简要进度说明，例如：[PROGRESS] 已完成代码审查。",
    "不需要每个动作都汇报，只在关键里程碑时输出。",
    "任务内容: do it",
  ].join("\n");

  expect(result).toBe(expected);
});

test("buildWorkerAnswerPrompt produces correct zh output byte-for-byte for known input", () => {
  const result = buildWorkerAnswerPrompt("proceed with plan A");

  const expected = [
    "以下是 coordinator 对你 blocker 的整理后答复，请基于这些明确指令继续当前任务。",
    "不要把原始 human 对话当成上下文来源；只执行下面的答案。",
    "答案：",
    "proceed with plan A",
  ].join("\n");

  expect(result).toBe(expected);
});
