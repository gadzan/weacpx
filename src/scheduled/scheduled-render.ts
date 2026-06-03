import { truncateText } from "../util/text.js";
import type { ScheduledTaskRecord } from "./scheduled-types";
import { LATER_MESSAGE_PREVIEW_CHARS } from "./scheduled-types";
import { t } from "../i18n";

function sessionLabel(task: ScheduledTaskRecord, displaySession: string): string {
  if (task.session_mode === "temp") {
    return t().scheduledRender.tempSession(task.workspace ?? "?", task.agent ?? "?");
  }
  return t().scheduledRender.boundSession(displaySession);
}

export function renderLaterHelp(): string {
  const sr = t().scheduledRender;
  return [
    sr.helpUsage,
    "",
    sr.helpCreate,
    sr.helpCreateEx1,
    sr.helpCreateEx2,
    sr.helpCreateEx3,
    sr.helpCreateEx4,
    "",
    sr.helpView,
    sr.helpViewCmd,
    "",
    sr.helpCancel,
    sr.helpCancelCmd,
    "",
    sr.helpNotes,
    sr.helpNote1,
    sr.helpNote2,
    sr.helpNote3,
    sr.helpNote4,
    sr.helpNote5,
    sr.helpNote6,
    sr.helpNote7,
  ].join("\n");
}

export function renderLaterUnsupportedChannel(): string {
  const sr = t().scheduledRender;
  return [
    sr.unsupportedChannel,
    "",
    sr.unsupportedChannelReason,
    sr.unsupportedChannelHint,
  ].join("\n");
}

export function renderTaskCreated(task: ScheduledTaskRecord, displaySession: string): string {
  const sr = t().scheduledRender;
  return [
    sr.taskCreated(task.id),
    sr.taskExecuteAt(formatLocalDateTime(new Date(task.execute_at))),
    sessionLabel(task, displaySession),
    sr.taskContent(preview(task.message)),
  ].join("\n");
}

export function renderLaterList(tasks: ScheduledTaskRecord[], displaySession: (internalAlias: string) => string): string {
  const sr = t().scheduledRender;
  if (tasks.length === 0) return sr.listEmpty;
  return [
    sr.listHeader,
    "",
    ...tasks.flatMap((task) => [
      `#${task.id}  ${formatLocalDateTime(new Date(task.execute_at))}  ${sessionLabel(task, displaySession(task.session_alias))}`,
      preview(task.message),
      "",
    ]),
  ].join("\n").trimEnd();
}

export function preview(text: string): string {
  return truncateText(text, LATER_MESSAGE_PREVIEW_CHARS);
}

export function formatLocalDateTime(date: Date): string {
  const sr = t().scheduledRender;
  const weekdays = [
    sr.weekdaySun,
    sr.weekdayMon,
    sr.weekdayTue,
    sr.weekdayWed,
    sr.weekdayThu,
    sr.weekdayFri,
    sr.weekdaySat,
  ];
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${weekdays[date.getDay()]} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
}
