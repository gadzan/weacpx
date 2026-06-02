import type { PermissionMessages } from "../../types";

export const permission: PermissionMessages = {
  // permissionHelp metadata
  helpSummary: "查看和修改 transport 权限策略。",
  helpCmdShow: "/pm 或 /permission",
  helpCmdShowDesc: "查看当前权限模式",
  helpCmdSet: "/pm set <allow|read|deny>",
  helpCmdSetDesc: "设置审批级别",
  helpCmdAuto: "/pm auto",
  helpCmdAutoDesc: "查看当前非交互策略",
  helpCmdAutoSet: "/pm auto <deny|fail>",
  helpCmdAutoSetDesc: "设置非交互策略",

  // handlePermissionModeSet / handlePermissionAutoSet — no writable config
  noWritableConfig: "当前没有加载可写入的配置。",

  // renderPermissionStatus — title variants (passed as title parameter)
  statusTitleCurrent: "当前权限模式：",
  statusTitleAutoStatus: "当前非交互策略：",
  statusTitleModeUpdated: "权限模式已更新：",
  statusTitleAutoUpdated: "非交互策略已更新：",
};
