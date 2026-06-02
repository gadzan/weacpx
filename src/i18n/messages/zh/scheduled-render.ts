import type { ScheduledRenderMessages } from "../../types";

export const scheduledRender: ScheduledRenderMessages = {
  // sessionLabel
  tempSession: (workspace, agent) => `临时会话（${workspace} · ${agent}）`,
  boundSession: (displaySession) => `会话：${displaySession}`,

  // renderLaterHelp
  helpUsage: "定时任务用法：",
  helpCreate: "创建：",
  helpCreateEx1: "/lt in 2h 检查 CI",
  helpCreateEx2: "/lt 30分钟后 总结进展",
  helpCreateEx3: "/lt tomorrow 09:00 看 PR",
  helpCreateEx4: "/lt 周五 09:00 继续处理",
  helpView: "查看：",
  helpViewCmd: "/lt list",
  helpCancel: "取消：",
  helpCancelCmd: "/lt cancel <id>",
  helpNotes: "说明：",
  helpNote1: "- 只支持一次性任务",
  helpNote2: "- 时间必须在 10 秒之后、7 天之内",
  helpNote3: "- 默认在为本次任务新建的临时会话里执行（跑完即销毁）",
  helpNote4: "- 加 --bind 改为发送到创建时绑定的当前会话",
  helpNote5: "- 触发通知和 agent 回复复用现有频道路由；微信回复额度由现有路由控制",
  helpNote6: "- 不支持延迟执行 / 开头的 xacpx 命令",
  helpNote7: "- 完整时间格式与说明见 docs/later-command.md",

  // renderLaterUnsupportedChannel
  unsupportedChannel: "当前频道暂不支持定时任务，未创建任务。",
  unsupportedChannelReason: "原因：这个频道还没有实现定时消息投递能力，任务到点后无法把结果发回原聊天。",
  unsupportedChannelHint: "请切换到支持定时任务的频道后再使用 /lt。",

  // renderTaskCreated
  taskCreated: (id) => `已创建定时任务 #${id}`,
  taskExecuteAt: (datetime) => `执行时间：${datetime}`,
  taskContent: (preview) => `内容：${preview}`,

  // renderLaterList
  listEmpty: "当前没有待执行定时任务。",
  listHeader: "待执行定时任务：",

  // formatLocalDateTime — weekdays
  weekdaySun: "周日",
  weekdayMon: "周一",
  weekdayTue: "周二",
  weekdayWed: "周三",
  weekdayThu: "周四",
  weekdayFri: "周五",
  weekdaySat: "周六",
};
