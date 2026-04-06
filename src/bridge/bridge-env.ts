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
