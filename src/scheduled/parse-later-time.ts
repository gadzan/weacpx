import { LATER_MAX_DELAY_MS, LATER_MIN_DELAY_MS } from "./scheduled-types";

export type LaterTimeParseErrorCode =
  | "missing_time"
  | "unrecognized_time"
  | "missing_message"
  | "past_today_time"
  | "too_soon"
  | "out_of_range";

export type LaterTimeParseResult =
  | { ok: true; executeAt: Date; messageStartIndex: number }
  | { ok: false; code: LaterTimeParseErrorCode; value?: string };

const WEEKDAYS = new Map<string, number>([
  ["周日", 0], ["周天", 0], ["星期日", 0], ["星期天", 0], ["sun", 0], ["sunday", 0],
  ["周一", 1], ["星期一", 1], ["mon", 1], ["monday", 1],
  ["周二", 2], ["星期二", 2], ["tue", 2], ["tuesday", 2],
  ["周三", 3], ["星期三", 3], ["wed", 3], ["wednesday", 3],
  ["周四", 4], ["星期四", 4], ["thu", 4], ["thursday", 4],
  ["周五", 5], ["星期五", 5], ["fri", 5], ["friday", 5],
  ["周六", 6], ["星期六", 6], ["sat", 6], ["saturday", 6],
]);

export function parseLaterTime(tokens: string[], now = new Date()): LaterTimeParseResult {
  if (tokens.length === 0) return { ok: false, code: "missing_time" };

  const relative = parseRelative(tokens, now);
  if (relative) return validateResult(relative.executeAt, relative.messageStartIndex, tokens, now);

  const absolute = parseAbsolute(tokens, now);
  if (absolute) return validateResult(absolute.executeAt, absolute.messageStartIndex, tokens, now, absolute.pastTodayValue);

  return { ok: false, code: "unrecognized_time" };
}

function parseRelative(tokens: string[], now: Date): { executeAt: Date; messageStartIndex: number } | null {
  if (tokens[0] === "in" && tokens[1]) {
    const ms = parseDuration(tokens[1]);
    if (ms !== null) return { executeAt: new Date(now.getTime() + ms), messageStartIndex: 2 };
  }
  const zh = /^(\d+)(分钟|小时|天)后$/.exec(tokens[0] ?? "");
  if (zh) {
    const amount = Number(zh[1]);
    const unit = zh[2];
    const ms = unit === "分钟" ? amount * 60_000 : unit === "小时" ? amount * 3_600_000 : amount * 86_400_000;
    return { executeAt: new Date(now.getTime() + ms), messageStartIndex: 1 };
  }
  return null;
}

function parseDuration(value: string): number | null {
  const match = /^(\d+)(m|min|minute|minutes|h|hour|hours|d|day|days)$/.exec(value.toLowerCase());
  if (!match) return null;
  const amount = Number(match[1]);
  const unit = match[2];
  if (unit === "m" || unit === "min" || unit === "minute" || unit === "minutes") return amount * 60_000;
  if (unit === "h" || unit === "hour" || unit === "hours") return amount * 3_600_000;
  return amount * 86_400_000;
}

function parseAbsolute(tokens: string[], now: Date): { executeAt: Date; messageStartIndex: number; pastTodayValue?: string } | null {
  if (tokens[0] === "at" && tokens[1]) {
    const parsed = parseClock(tokens[1]);
    if (!parsed) return null;
    const executeAt = atLocalDate(now, 0, parsed.hour, parsed.minute);
    if (executeAt.getTime() <= now.getTime()) return { executeAt, messageStartIndex: 2, pastTodayValue: tokens[1] };
    return { executeAt, messageStartIndex: 2 };
  }

  const dayWord = tokens[0]?.toLowerCase();
  const dayOffset = dayWord === "today" || dayWord === "今天" ? 0
    : dayWord === "tomorrow" || dayWord === "明天" ? 1
      : dayWord === "后天" ? 2
        : null;
  if (dayOffset !== null && tokens[1]) {
    const parsed = parseClock(tokens[1]);
    if (!parsed) return null;
    const executeAt = atLocalDate(now, dayOffset, parsed.hour, parsed.minute);
    if (dayOffset === 0 && executeAt.getTime() <= now.getTime()) return { executeAt, messageStartIndex: 2, pastTodayValue: tokens[1] };
    return { executeAt, messageStartIndex: 2 };
  }

  const weekday = WEEKDAYS.get(tokens[0]?.toLowerCase() ?? "");
  if (weekday !== undefined && tokens[1]) {
    const parsed = parseClock(tokens[1]);
    if (!parsed) return null;
    let days = (weekday - now.getDay() + 7) % 7;
    let executeAt = atLocalDate(now, days, parsed.hour, parsed.minute);
    if (days === 0 && executeAt.getTime() <= now.getTime()) {
      days = 7;
      executeAt = atLocalDate(now, days, parsed.hour, parsed.minute);
    }
    return { executeAt, messageStartIndex: 2 };
  }

  return null;
}

function parseClock(value: string): { hour: number; minute: number } | null {
  const match = /^(\d{1,2}):(\d{2})$/.exec(value);
  if (!match) return null;
  const hour = Number(match[1]);
  const minute = Number(match[2]);
  if (hour < 0 || hour > 23 || minute < 0 || minute > 59) return null;
  return { hour, minute };
}

function atLocalDate(now: Date, dayOffset: number, hour: number, minute: number): Date {
  return new Date(now.getFullYear(), now.getMonth(), now.getDate() + dayOffset, hour, minute, 0, 0);
}

function validateResult(
  executeAt: Date,
  messageStartIndex: number,
  tokens: string[],
  now: Date,
  pastTodayValue?: string,
): LaterTimeParseResult {
  if (pastTodayValue) return { ok: false, code: "past_today_time", value: pastTodayValue };
  if (tokens.slice(messageStartIndex).join(" ").trim().length === 0) return { ok: false, code: "missing_message" };
  const delta = executeAt.getTime() - now.getTime();
  if (delta < LATER_MIN_DELAY_MS) return { ok: false, code: "too_soon" };
  if (delta > LATER_MAX_DELAY_MS) return { ok: false, code: "out_of_range" };
  return { ok: true, executeAt, messageStartIndex };
}
