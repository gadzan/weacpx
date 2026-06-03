import type { PermissionMessages } from "../../types";

export const permission: PermissionMessages = {
  // permissionHelp metadata
  helpSummary: "View and modify the transport permission policy.",
  helpCmdShow: "/pm or /permission",
  helpCmdShowDesc: "View the current permission mode",
  helpCmdSet: "/pm set <allow|read|deny>",
  helpCmdSetDesc: "Set the approval level",
  helpCmdAuto: "/pm auto",
  helpCmdAutoDesc: "View the current non-interactive policy",
  helpCmdAutoSet: "/pm auto <deny|fail>",
  helpCmdAutoSetDesc: "Set the non-interactive policy",

  // handlePermissionModeSet / handlePermissionAutoSet — no writable config
  noWritableConfig: "No writable config is currently loaded.",

  // renderPermissionStatus — title variants (passed as title parameter)
  statusTitleCurrent: "Current permission mode:",
  statusTitleAutoStatus: "Current non-interactive policy:",
  statusTitleModeUpdated: "Permission mode updated:",
  statusTitleAutoUpdated: "Non-interactive policy updated:",
};
