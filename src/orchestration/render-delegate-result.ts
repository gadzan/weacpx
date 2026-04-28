import type { OrchestrationTaskRecord } from "./orchestration-types";

export function renderDelegateResultBlocks(tasks: OrchestrationTaskRecord[]): string {
  return tasks
    .map((task) => {
      const result =
        task.status === "failed" ? task.summary || task.resultText || "unknown failure" : task.resultText;

      return [
        "[delegate_result]",
        `task_id: ${task.taskId}`,
        `worker_session: ${task.workerSession ?? "unassigned"}`,
        `target_agent: ${task.targetAgent}`,
        `status: ${task.status}`,
        "",
        "result:",
        result,
        "[/delegate_result]",
      ].join("\n");
    })
    .join("\n\n");
}
