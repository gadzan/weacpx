import type { ScheduledTaskRecord } from "./scheduled-types";
import { LATER_MESSAGE_PREVIEW_CHARS } from "./scheduled-types";

export function renderLaterHelp(): string {
  return [
    "定时任务用法：",
    "",
    "创建：",
    "/lt in 2h 检查 CI",
    "/lt 30分钟后 总结进展",
    "/lt tomorrow 09:00 看 PR",
    "/lt 周五 09:00 继续处理",
    "",
    "查看：",
    "/lt list",
    "",
    "取消：",
    "/lt cancel <id>",
    "",
    "说明：",
    "- 只支持一次性任务",
    "- 时间必须在 10 秒之后、7 天之内",
    "- 到点后会把消息发送到创建时绑定的会话",
    "- 触发通知和 agent 回复复用现有频道路由；微信回复额度由现有路由控制",
    "- 不支持延迟执行 / 开头的 weacpx 命令",
  ].join("\n");
}

export function renderTaskCreated(task: ScheduledTaskRecord, displaySession: string): string {
  return [
    `已创建定时任务 #${task.id}`,
    `执行时间：${formatLocalDateTime(new Date(task.execute_at))}`,
    `会话：${displaySession}`,
    `内容：${preview(task.message)}`,
  ].join("\n");
}

export function renderLaterList(tasks: ScheduledTaskRecord[], displaySession: (internalAlias: string) => string): string {
  if (tasks.length === 0) return "当前没有待执行定时任务。";
  return [
    "待执行定时任务：",
    "",
    ...tasks.flatMap((task) => [
      `#${task.id}  ${formatLocalDateTime(new Date(task.execute_at))}  会话：${displaySession(task.session_alias)}`,
      preview(task.message),
      "",
    ]),
  ].join("\n").trimEnd();
}

export function preview(text: string): string {
  return text.length <= LATER_MESSAGE_PREVIEW_CHARS
    ? text
    : `${text.slice(0, LATER_MESSAGE_PREVIEW_CHARS - 1)}…`;
}

export function formatLocalDateTime(date: Date): string {
  const weekdays = ["周日", "周一", "周二", "周三", "周四", "周五", "周六"];
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${weekdays[date.getDay()]} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
}
