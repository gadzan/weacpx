import { expect, test } from "bun:test";

import { parseLaterTime } from "../../../src/scheduled/parse-later-time";

const now = new Date("2026-05-23T10:00:00+08:00"); // Saturday, 02:00 UTC

function ok(tokens: string[]) {
  const result = parseLaterTime(tokens, now);
  if (!result.ok) throw new Error(`expected ok, got ${result.code}`);
  return result;
}

test("parses relative English time", () => {
  const result = ok(["in", "2h", "检查", "CI"]);
  expect(result.executeAt.toISOString()).toBe("2026-05-23T04:00:00.000Z");
  expect(result.messageStartIndex).toBe(2);
});

test("parses relative Chinese time", () => {
  const result = ok(["30分钟后", "总结"]);
  expect(result.executeAt.toISOString()).toBe("2026-05-23T02:30:00.000Z");
  expect(result.messageStartIndex).toBe(1);
});

test("parses at, tomorrow and weekday absolute times", () => {
  const r1 = ok(["at", "21:30", "继续"]);
  expect(r1.executeAt.getHours()).toBe(21);
  expect(r1.executeAt.getMinutes()).toBe(30);
  expect(r1.messageStartIndex).toBe(2);

  const r2 = ok(["明天", "09:00", "看", "PR"]);
  expect(r2.executeAt.getDate()).toBe(24);
  expect(r2.executeAt.getHours()).toBe(9);
  expect(r2.messageStartIndex).toBe(2);

  const r3 = ok(["周五", "09:00", "看", "PR"]);
  expect(r3.executeAt.getDay()).toBe(5);
  expect(r3.executeAt.getHours()).toBe(9);
  expect(r3.messageStartIndex).toBe(2);

  const r4 = ok(["friday", "09:00", "看", "PR"]);
  expect(r4.executeAt.getDay()).toBe(5);
  expect(r4.executeAt.getHours()).toBe(9);
  expect(r4.messageStartIndex).toBe(2);
});

test("parses today and 后天", () => {
  const r1 = ok(["today", "21:00", "继续"]);
  expect(r1.executeAt.getDate()).toBe(23);
  expect(r1.executeAt.getHours()).toBe(21);

  const r2 = ok(["后天", "10:00", "继续"]);
  expect(r2.executeAt.getDate()).toBe(25);
  expect(r2.executeAt.getHours()).toBe(10);
});

test("rejects past today time", () => {
  const localNow = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 10, 0, 0, 0);
  const result = parseLaterTime(["at", "09:00", "继续"], localNow);
  expect(result).toEqual({ ok: false, code: "past_today_time", value: "09:00" });
});

test("rejects too soon in 5s", () => {
  const result = parseLaterTime(["in", "5s", "继续"], now);
  expect(result).toEqual({ ok: false, code: "unrecognized_time" });
});

test("rejects out of range in 8d", () => {
  const result = parseLaterTime(["in", "8d", "继续"], now);
  expect(result).toEqual({ ok: false, code: "out_of_range" });
});

test("rejects unsupported natural language", () => {
  const result = parseLaterTime(["半小时后", "继续"], now);
  expect(result).toEqual({ ok: false, code: "unrecognized_time" });
});

test("rejects missing time tokens", () => {
  expect(parseLaterTime([], now)).toEqual({ ok: false, code: "missing_time" });
});

test("rejects missing message after time", () => {
  const result = parseLaterTime(["in", "2h"], now);
  expect(result).toEqual({ ok: false, code: "missing_message" });
});

test("rejects invalid clock format", () => {
  const result = parseLaterTime(["at", "25:00", "继续"], now);
  expect(result).toEqual({ ok: false, code: "unrecognized_time" });
});

test("weekday same-day past time moves to next week", () => {
  const saturdayAt8 = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 8, 0, 0, 0);
  const result = parseLaterTime(["周六", "07:00", "继续"], saturdayAt8);
  if (!result.ok) throw new Error(`expected ok, got ${result.code}`);
  expect(result.executeAt.getDay()).toBe(6);
  expect(result.executeAt.getHours()).toBe(7);
  expect(result.executeAt.getDate()).toBe(30);
});

test("parses various weekday names", () => {
  const r1 = ok(["周一", "12:00", "x"]);
  expect(r1.executeAt.getDay()).toBe(1);

  const r2 = ok(["星期三", "12:00", "x"]);
  expect(r2.executeAt.getDay()).toBe(3);

  const r3 = ok(["wednesday", "12:00", "x"]);
  expect(r3.executeAt.getDay()).toBe(3);

  const r4 = ok(["周天", "12:00", "x"]);
  expect(r4.executeAt.getDay()).toBe(0);
});

// ---- Bug B: Invalid Date from huge digit count ----

test("rejects astronomically large day count (overflow → Invalid Date)", () => {
  // 99999999999999d overflows Date range → getTime() is NaN.
  // Must return ok:false with out_of_range, not ok:true with an Invalid Date.
  const result = parseLaterTime(["in", "99999999999999d", "继续"], now);
  expect(result.ok).toBe(false);
  if (!result.ok) expect(result.code).toBe("out_of_range");
});

test("rejects astronomically large hour count (overflow → Invalid Date)", () => {
  const result = parseLaterTime(["in", "999999999999h", "继续"], now);
  expect(result.ok).toBe(false);
  if (!result.ok) expect(result.code).toBe("out_of_range");
});

test("normal 5m duration still works after NaN guard", () => {
  // Sanity-check that the guard does not break ordinary inputs.
  const result = parseLaterTime(["in", "5m", "继续"], now);
  expect(result.ok).toBe(true);
});
