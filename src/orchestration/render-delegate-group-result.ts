import type { OrchestrationGroupRecord, OrchestrationTaskRecord } from "./orchestration-types";

const MAX_RESULT_CHARS = 600;

function pickBody(task: OrchestrationTaskRecord): string {
  if (task.status === "failed") {
    return task.summary || task.resultText || "unknown failure";
  }
  return task.resultText || task.summary || "";
}

function truncate(body: string, taskId: string): string {
  if (body.length <= MAX_RESULT_CHARS) {
    return body;
  }
  return `${body.slice(0, MAX_RESULT_CHARS)}\n... (结果已截断，完整内容请执行 /task ${taskId})`;
}

function formatRow(task: OrchestrationTaskRecord): string {
  const body = truncate(pickBody(task), task.taskId);
  const header = `- [${task.status}] ${task.targetAgent} / ${task.taskId}`;
  return body ? `${header}\n${body}` : header;
}

function pickNextAction(successes: number, failures: number, other: number): string {
  if (successes === 0 && failures === 0 && other === 0) {
    return "本组没有任何成员，可忽略此聚合结果。";
  }
  if (failures > 0 && successes > 0) {
    return "优先分析 failures 段的失败原因，并决定是否基于 successes 结果继续推进。";
  }
  if (failures > 0) {
    return "本组全部失败，请先诊断 failures 段后再决定下一步。";
  }
  if (other > 0 && successes === 0) {
    return "本组尚未产出结果，其余成员仍在进行或已取消。";
  }
  if (other > 0) {
    return "可基于 successes 段继续推进，其余成员仍在进行或已取消。";
  }
  return "可基于 successes 段继续推进。";
}

export function renderDelegateGroupResult(
  group: OrchestrationGroupRecord,
  tasks: OrchestrationTaskRecord[],
): string {
  const successes = tasks.filter((t) => t.status === "completed");
  const failures = tasks.filter((t) => t.status === "failed");
  const other = tasks.filter((t) => t.status !== "completed" && t.status !== "failed");
  const cancelled = tasks.filter((t) => t.status === "cancelled");

  const sections: string[] = [];
  if (successes.length > 0) {
    sections.push("successes:", ...successes.map(formatRow));
  }
  if (failures.length > 0) {
    if (sections.length > 0) sections.push("");
    sections.push("failures:", ...failures.map(formatRow));
  }
  if (other.length > 0) {
    if (sections.length > 0) sections.push("");
    sections.push("other:", ...other.map(formatRow));
  }

  const body = sections.length > 0 ? ["", ...sections, ""] : [""];

  return [
    "[delegate_group_result]",
    `group_id: ${group.groupId}`,
    `title: ${group.title}`,
    `total: ${tasks.length}`,
    `completed: ${successes.length}`,
    `failed: ${failures.length}`,
    `cancelled: ${cancelled.length}`,
    ...body,
    `next_action: ${pickNextAction(successes.length, failures.length, other.length)}`,
    "[/delegate_group_result]",
  ].join("\n");
}

export function renderDelegateGroupResultBlocks(
  groups: Array<{ group: OrchestrationGroupRecord; tasks: OrchestrationTaskRecord[] }>,
): string {
  return groups.map(({ group, tasks }) => renderDelegateGroupResult(group, tasks)).join("\n\n");
}
