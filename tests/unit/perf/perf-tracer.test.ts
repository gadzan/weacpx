import { expect, test } from "bun:test";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { createPerfTracer, createNoopPerfTracer } from "../../../src/perf/perf-tracer";

function makeAppLoggerSpy() {
  const errorCalls: Array<{ event: string; ctx: Record<string, unknown> }> = [];
  return {
    logger: {
      debug: async () => {},
      info: async () => {},
      error: async (event: string, _msg: string, ctx: Record<string, unknown>) => {
        errorCalls.push({ event, ctx });
      },
      cleanup: async () => {},
      flush: async () => {},
    },
    errorCalls,
  };
}

test("noop tracer never calls injected time / rng APIs", async () => {
  const tracer = createNoopPerfTracer();

  await tracer.wrapTurn({ chatKey: "wx:a", kind: "prompt" }, async (span) => {
    span.mark("turn.received");
    span.mark("transport.prompt_done", { localOutcome: "ok" });
    span.setOutcome("ok");
  });
  // Just verify it runs without throwing — the noop span's mark/setOutcome are no-ops
  // and tracer.wrapTurn calls run(NOOP_SPAN) directly with no time-source calls.
  // (No assertions on injected APIs because noop tracer doesn't accept injections.)
});

test("real tracer writes mark lines and summary line", async () => {
  const dir = await mkdtemp(join(tmpdir(), "weacpx-tracer-"));
  const file = join(dir, "perf.log");
  const { logger } = makeAppLoggerSpy();
  let n = 0;
  let counter = 0;
  const tracer = createPerfTracer({
    filePath: file,
    maxSizeBytes: 1_000_000,
    maxFiles: 3,
    retentionDays: 7,
    appLogger: logger as any,
    now: () => n++,
    isoNow: () => new Date("2026-05-15T08:42:13.000Z"),
    randomId: () => `t${(counter++).toString().padStart(11, "0")}`,
  });

  await tracer.wrapTurn({ chatKey: "wx:abc", kind: "prompt" }, async (span) => {
    span.mark("turn.received", { textLen: 5 });
    span.mark("agent.dispatched");
    span.setOutcome("ok");
  });
  await tracer.flush();

  const content = await readFile(file, "utf8");
  const lines = content.trim().split("\n");
  expect(lines.length).toBe(3); // 2 marks + 1 summary
  expect(lines[0]).toContain('PERF turn.received trace=t00000000000 chatKey="wx:abc" textLen=5 sinceStartMs=0 sinceLastMs=0');
  expect(lines[1]).toContain('PERF agent.dispatched trace=t00000000000 chatKey="wx:abc" sinceStartMs=1 sinceLastMs=1');
  expect(lines[2]).toContain('PERF turn.done trace=t00000000000 chatKey="wx:abc" kind="prompt" outcome="ok" totalMs=2');
  expect(lines[2]).toMatch(/ marks="\[\{\\"e\\":\\"turn.received\\",\\"t\\":0\},\{\\"e\\":\\"agent.dispatched\\",\\"t\\":1\}\]"$/);

  await rm(dir, { recursive: true, force: true });
});

test("outcome matrix: explicit setOutcome wins, throw → error, default ok", async () => {
  const dir = await mkdtemp(join(tmpdir(), "weacpx-tracer-"));
  const file = join(dir, "perf.log");
  const { logger } = makeAppLoggerSpy();
  let n = 0;
  let counter = 0;
  const tracer = createPerfTracer({
    filePath: file,
    maxSizeBytes: 1_000_000,
    maxFiles: 3,
    retentionDays: 7,
    appLogger: logger as any,
    now: () => n++,
    isoNow: () => new Date("2026-05-15T00:00:00.000Z"),
    randomId: () => `t${(counter++).toString().padStart(11, "0")}`,
  });

  // case 1: setOutcome aborted + normal return
  await tracer.wrapTurn({ chatKey: "k", kind: "prompt" }, async (span) => {
    span.setOutcome("aborted");
  });
  // case 2: setOutcome aborted + throw
  await expect(
    tracer.wrapTurn({ chatKey: "k", kind: "prompt" }, async (span) => {
      span.setOutcome("aborted");
      throw new Error("boom");
    }),
  ).rejects.toThrow("boom");
  // case 3: throw without setOutcome
  await expect(
    tracer.wrapTurn({ chatKey: "k", kind: "prompt" }, async () => {
      throw new Error("oops");
    }),
  ).rejects.toThrow("oops");
  // case 4: normal return without setOutcome
  await tracer.wrapTurn({ chatKey: "k", kind: "prompt" }, async () => {});
  await tracer.flush();

  const content = await readFile(file, "utf8");
  const summaries = content.split("\n").filter((l) => l.includes("turn.done"));
  expect(summaries[0]).toContain('outcome="aborted"');
  expect(summaries[1]).toContain('outcome="aborted"');
  expect(summaries[2]).toContain('outcome="error"');
  expect(summaries[3]).toContain('outcome="ok"');

  await rm(dir, { recursive: true, force: true });
});

test("perf internal end() failure does not mask business exception", async () => {
  const { logger } = makeAppLoggerSpy();
  let n = 0;
  let counter = 0;
  const tracer = createPerfTracer({
    filePath: "/dev/null",
    maxSizeBytes: 1_000_000,
    maxFiles: 3,
    retentionDays: 7,
    appLogger: logger as any,
    now: () => n++,
    isoNow: () => new Date("2026-05-15T00:00:00.000Z"),
    randomId: () => `t${(counter++).toString().padStart(11, "0")}`,
    // Sabotage summary formatting (runs inside wrapTurn finally):
    formatSummaryLine: () => { throw new Error("formatter explosion"); },
  });

  await expect(
    tracer.wrapTurn({ chatKey: "k", kind: "prompt" }, async () => {
      throw new Error("business failure");
    }),
  ).rejects.toThrow("business failure");
});

test("concurrent wrapTurn yields unique traceIds (injected counter)", async () => {
  const dir = await mkdtemp(join(tmpdir(), "weacpx-tracer-"));
  const file = join(dir, "perf.log");
  const { logger } = makeAppLoggerSpy();
  let counter = 0;
  const tracer = createPerfTracer({
    filePath: file,
    maxSizeBytes: 10_000_000,
    maxFiles: 3,
    retentionDays: 7,
    appLogger: logger as any,
    now: () => 0,
    isoNow: () => new Date("2026-05-15T00:00:00.000Z"),
    randomId: () => `t${(counter++).toString().padStart(11, "0")}`,
  });

  const promises = [];
  for (let i = 0; i < 1000; i += 1) {
    promises.push(tracer.wrapTurn({ chatKey: "k", kind: "prompt" }, async () => {}));
  }
  await Promise.all(promises);
  await tracer.flush();

  const content = await readFile(file, "utf8");
  const traces = new Set(
    content.split("\n").filter((l) => l.includes("turn.done")).map((l) => l.match(/trace=(\S+)/)?.[1]),
  );
  expect(traces.size).toBe(1000);

  await rm(dir, { recursive: true, force: true });
});
