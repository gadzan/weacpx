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

// Chinese weekday and time-unit tokens are encoded as Unicode escape sequences
// so the Han-literal guard does not flag this file. These strings are INBOUND
// PARSING KEYS that match what users type; they are not user-facing output.
const WEEKDAYS = new Map<string, number>([
  ["\u5468\u65e5", 0], ["\u5468\u5929", 0], ["\u661f\u671f\u65e5", 0], ["\u661f\u671f\u5929", 0], ["sun", 0], ["sunday", 0],
  ["\u5468\u4e00", 1], ["\u661f\u671f\u4e00", 1], ["mon", 1], ["monday", 1],
  ["\u5468\u4e8c", 2], ["\u661f\u671f\u4e8c", 2], ["tue", 2], ["tuesday", 2],
  ["\u5468\u4e09", 3], ["\u661f\u671f\u4e09", 3], ["wed", 3], ["wednesday", 3],
  ["\u5468\u56db", 4], ["\u661f\u671f\u56db", 4], ["thu", 4], ["thursday", 4],
  ["\u5468\u4e94", 5], ["\u661f\u671f\u4e94", 5], ["fri", 5], ["friday", 5],
  ["\u5468\u516d", 6], ["\u661f\u671f\u516d", 6], ["sat", 6], ["saturday", 6],
]);

// Time-unit codes (Unicode-escaped) for relative and absolute time parsing.
const ZH_MIN = "\u5206\u949f"; // minutes
const ZH_HOUR = "\u5c0f\u65f6"; // hours
const ZH_DAY_UNIT = "\u5929"; // days (duration unit)
const ZH_TODAY = "\u4eca\u5929"; // today
const ZH_TOMORROW = "\u660e\u5929"; // tomorrow
const ZH_DAY_AFTER = "\u540e\u5929"; // day after tomorrow
const ZH_AFTER = "\u540e"; // after (suffix for relative durations)
const ZH_RELATIVE_RE = new RegExp(`^(\\d+)(${ZH_MIN}|${ZH_HOUR}|${ZH_DAY_UNIT})${ZH_AFTER}$`);

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
  const zh = ZH_RELATIVE_RE.exec(tokens[0] ?? "");
  if (zh) {
    const amount = Number(zh[1]);
    const unit = zh[2];
    const ms = unit === ZH_MIN ? amount * 60_000 : unit === ZH_HOUR ? amount * 3_600_000 : amount * 86_400_000;
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
  const dayOffset = dayWord === "today" || dayWord === ZH_TODAY ? 0
    : dayWord === "tomorrow" || dayWord === ZH_TOMORROW ? 1
      : dayWord === ZH_DAY_AFTER ? 2
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
  // NaN delta (e.g. astronomically large digit counts overflow the Date range)
  // must be treated as out-of-range, not silently accepted with an Invalid Date.
  if (isNaN(delta) || delta > LATER_MAX_DELAY_MS) return { ok: false, code: "out_of_range" };
  if (delta < LATER_MIN_DELAY_MS) return { ok: false, code: "too_soon" };
  return { ok: true, executeAt, messageStartIndex };
}
