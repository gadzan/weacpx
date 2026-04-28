import type { AppState } from "../../state/types";
import type { DoctorCheckResult } from "../doctor-types";

export interface CheckOrchestrationHealthOptions {
  loadState: () => Promise<AppState>;
  now: () => Date;
  heartbeatThresholdSeconds: number;
}

export async function checkOrchestrationHealth(
  options: CheckOrchestrationHealthOptions,
): Promise<DoctorCheckResult> {
  const state = await options.loadState();
  const now = options.now().getTime();
  const threshold = options.heartbeatThresholdSeconds;

  const tasks = Object.values(state.orchestration.tasks);
  const bindings = state.orchestration.workerBindings ?? {};

  const stuckTasks = tasks.filter((task) => {
    if (task.status !== "running") return false;
    const reference = task.lastProgressAt ?? task.createdAt;
    return (now - new Date(reference).getTime()) / 1000 >= threshold;
  });

  const pendingNotices = tasks.filter((task) => task.noticePending === true);
  const failedNotices = pendingNotices.filter((task) => task.lastNoticeError);
  const pendingInjections = tasks.filter(
    (task) =>
      task.injectionPending === true &&
      (task.status === "completed" || task.status === "failed"),
  );
  const failedInjections = pendingInjections.filter((task) => task.lastInjectionError);

  const referencedWorkers = new Set(
    tasks.map((t) => t.workerSession).filter((s): s is string => typeof s === "string"),
  );
  const orphanBindings = Object.entries(bindings)
    .filter(([workerSession]) => !referencedWorkers.has(workerSession))
    .map(([workerSession]) => workerSession);

  const details: string[] = [];
  for (const task of stuckTasks) {
    details.push(
      `stuck task ${task.taskId}: ${task.targetAgent} running since ${task.lastProgressAt ?? task.createdAt}`,
    );
  }
  for (const task of failedNotices) {
    details.push(`notice failed for task ${task.taskId}: ${task.lastNoticeError}`);
  }
  for (const task of failedInjections) {
    details.push(`injection failed for task ${task.taskId}: ${task.lastInjectionError}`);
  }
  for (const binding of orphanBindings) {
    details.push(`orphan worker binding: ${binding}`);
  }

  const problems =
    stuckTasks.length + failedNotices.length + failedInjections.length + orphanBindings.length;

  return {
    id: "orchestration",
    label: "Orchestration",
    severity: problems > 0 ? "warn" : "pass",
    summary:
      problems === 0
        ? "orchestration state healthy"
        : `${stuckTasks.length} stuck / ${failedNotices.length} notice-failed / ${failedInjections.length} injection-failed / ${orphanBindings.length} orphan bindings`,
    ...(details.length > 0 ? { details } : {}),
    ...(problems > 0
      ? {
          suggestions: [
            "查看 /tasks --stuck 定位卡住的任务",
            "/task <id> 可看完整时间线定位错误点",
            "必要时用 /task cancel 或 /tasks clean 恢复",
          ],
        }
      : {}),
  };
}
