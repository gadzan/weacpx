import type { PermissionMode } from "../config/types";

export function permissionModeToFlag(permissionMode: PermissionMode): string {
  switch (permissionMode) {
    case "approve-reads":
      return "--approve-reads";
    case "deny-all":
      return "--deny-all";
    case "approve-all":
      return "--approve-all";
  }
}
