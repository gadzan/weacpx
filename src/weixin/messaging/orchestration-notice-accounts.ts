import type { OrchestrationTaskRecord } from "../../orchestration/orchestration-types";

export function resolveOrchestrationNoticeAccountIds(
  task: Pick<OrchestrationTaskRecord, "accountId" | "deliveryAccountId">,
  availableAccountIds: string[],
): string[] {
  const ordered = [task.deliveryAccountId, task.accountId, ...availableAccountIds]
    .filter((value): value is string => typeof value === "string" && value.trim().length > 0)
    .map((value) => value.trim());

  return [...new Set(ordered)];
}
