import type { LaterMessages } from "../../types";

export const later: LaterMessages = {
  // command-router.ts — scheduled service not enabled
  serviceNotEnabled: "定时任务服务未启用。",

  // handleLaterCreate — flags mutually exclusive
  bindAndTempMutuallyExclusive: "定时任务的 --bind 与 --temp 不能同时使用。",

  // handleLaterCreate — no current session
  noSession: "当前没有会话，无法创建定时任务。",
  noSessionHint: "请先创建或切换到一个会话：",
  noSessionExampleNew: "- /ss codex --ws backend（新建并切换）",
  noSessionExampleUse: "- /use backend-codex（切换到已有会话）",

  // handleLaterCreate — slash-prefixed message rejected
  slashMessageRejected: "不支持延迟执行 / 开头的命令。",
  slashMessageHint: "如果需要让 agent 解释命令，可以用自然语言描述：",
  slashMessageExample: "例如：/lt in 1h 请解释 /status 的作用",

  // handleLaterCancel — success
  cancelSuccess: (id) => `已取消定时任务 #${id}`,

  // handleLaterCancel — not found
  cancelNotFound: (id) => `未找到待执行的定时任务 #${id}。`,
  cancelNotFoundHint: "可以用 /lt list 查看当前待执行任务。",

  // renderTimeParseError
  missingMessage: "定时任务需要消息内容，请在时间后附上要发送的内容。",
  tooSoon: "定时任务执行时间必须在 10 秒之后。",
  outOfRange: "定时任务执行时间不能超过 7 天。",
  pastTodayTime: (value) => `今天 ${value} 已经过了，请指定一个未来的时间，或使用「明天」。`,
  unrecognizedTime: "无法识别时间格式。",
  unrecognizedTimeFormats: "支持的格式：",
  unrecognizedTimeExample1: "- /lt in 2h 消息（2小时后）",
  unrecognizedTimeExample2: "- /lt 30分钟后 消息",
  unrecognizedTimeExample3: "- /lt tomorrow 09:00 消息",
  unrecognizedTimeExample4: "- /lt 周五 09:00 消息",

  // laterHelp metadata
  helpSummary: "定时任务：到点在临时会话执行（或 --bind 发到当前会话）",
  helpCmdCreate: "/lt <时间> <消息>",
  helpCmdCreateDesc: "创建定时任务",
  helpCmdBind: "/lt --bind <时间> <消息>",
  helpCmdBindDesc: "改为发送到当前会话",
  helpCmdTemp: "/lt --temp <时间> <消息>",
  helpCmdTempDesc: "强制使用临时会话",
  helpCmdList: "/lt list",
  helpCmdListDesc: "查看待执行定时任务",
  helpCmdCancel: "/lt cancel <id>",
  helpCmdCancelDesc: "取消定时任务",
  helpExample1: "/lt in 2h 检查 CI",
  helpExample2: "/lt 30分钟后 总结进展",
  helpExample3: "/lt tomorrow 09:00 看 PR",
  helpExample4: "/lt 今天 21:30 继续处理",
  helpExample5: "/lt 周五 09:00 继续处理",
  helpNote1: "只支持一次性任务，不支持重复执行",
  helpNote2: "时间必须在 10 秒之后、7 天之内",
  helpNote3: "默认在为本次任务新建的临时会话里执行，跑完即销毁",
  helpNote4: "加 --bind 改为发送到创建时绑定的当前会话（默认模式可用 later.defaultMode 配置）",
  helpNote5: "/lt list 只显示本聊天创建的待执行任务；群聊中只有群主可取消",
  helpNote6: "不支持延迟执行 / 开头的 xacpx 命令",
  helpNote7: "完整时间格式与说明见 docs/later-command.md",
};
