import type { NonInteractivePermissions, PermissionMode } from "../config/types";

export function normalizeBridgePermissionMode(value: string | undefined): PermissionMode {
  return value === "approve-reads" || value === "deny-all" || value === "approve-all"
    ? value
    : "approve-all";
}

export function normalizeBridgeNonInteractivePermissions(
  value: string | undefined,
): NonInteractivePermissions {
  return value === "deny" || value === "fail" ? value : "deny";
}

export function normalizeBridgePermissionPolicy(value: string | undefined): string | undefined {
  if (typeof value !== "string" || value.trim().length === 0) {
    return undefined;
  }
  return value;
}

export function normalizeBridgeSessionInitTimeoutMs(value: string | undefined): number | undefined {
  if (value === undefined || value.trim().length === 0) {
    return undefined;
  }
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : undefined;
}

export function normalizeBridgeQueueOwnerTtlSeconds(value: string | undefined): number | undefined {
  if (value === undefined) {
    return undefined;
  }
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : undefined;
}
