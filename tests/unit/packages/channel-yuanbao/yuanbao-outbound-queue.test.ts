import { expect, test } from "bun:test";

import {
  createOutboundQueueSession,
  type OutboundQueueScheduledTimer,
  type OutboundQueueScheduler,
} from "../../../../packages/channel-yuanbao/src/outbound-queue";

interface ManualClock {
  schedule: OutboundQueueScheduler;
  advance: (ms: number) => void;
  pending: () => number;
}

function createManualClock(): ManualClock {
  let now = 0;
  const timers = new Map<number, { fireAt: number; handler: () => void }>();
  let nextId = 1;
  const schedule: OutboundQueueScheduler = (handler, ms): OutboundQueueScheduledTimer => {
    const id = nextId++;
    timers.set(id, { fireAt: now + ms, handler });
    return { cancel: () => { timers.delete(id); } };
  };
  const advance = (ms: number): void => {
    now += ms;
    for (const [id, t] of [...timers.entries()]) {
      if (t.fireAt <= now) {
        timers.delete(id);
        t.handler();
      }
    }
  };
  return { schedule, advance, pending: () => timers.size };
}

test("immediate strategy sends each push as its own message", async () => {
  const sent: string[] = [];
  const session = createOutboundQueueSession({
    strategy: "immediate",
    minChars: 100,
    maxChars: 1000,
    idleMs: 5000,
    sendText: async (text) => { sent.push(text); },
  });
  await session.push("hello");
  await session.push("world");
  const r = await session.flush();
  expect(sent).toEqual(["hello", "world"]);
  expect(r.sentContent).toBe(true);
});

test("immediate strategy applies markdown-aware chunking when text exceeds maxChars", async () => {
  const sent: string[] = [];
  const session = createOutboundQueueSession({
    strategy: "immediate",
    minChars: 10,
    maxChars: 10,
    idleMs: 1000,
    sendText: async (text) => { sent.push(text); },
  });
  await session.push("abc def ghi jkl mno");
  await session.flush();
  expect(sent.join("")).toBe("abc def ghi jkl mno");
  expect(sent.length).toBeGreaterThan(1);
});

test("merge-text buffers under minChars and flushes at end", async () => {
  const sent: string[] = [];
  const clock = createManualClock();
  const session = createOutboundQueueSession({
    strategy: "merge-text",
    minChars: 50,
    maxChars: 100,
    idleMs: 5000,
    schedule: clock.schedule,
    sendText: async (text) => { sent.push(text); },
  });
  await session.push("short ");
  await session.push("text");
  expect(sent).toEqual([]);
  await session.flush();
  expect(sent).toEqual(["short text"]);
});

test("merge-text flushes when buffer crosses minChars", async () => {
  const sent: string[] = [];
  const clock = createManualClock();
  const session = createOutboundQueueSession({
    strategy: "merge-text",
    minChars: 10,
    maxChars: 100,
    idleMs: 5000,
    schedule: clock.schedule,
    sendText: async (text) => { sent.push(text); },
  });
  await session.push("hello");
  expect(sent).toEqual([]);
  await session.push("hello world");
  expect(sent).toEqual(["hellohello world"]);
});

test("merge-text fires idleMs drain when buffer is non-empty and idle", async () => {
  const sent: string[] = [];
  const clock = createManualClock();
  const session = createOutboundQueueSession({
    strategy: "merge-text",
    minChars: 100,
    maxChars: 200,
    idleMs: 1000,
    schedule: clock.schedule,
    sendText: async (text) => { sent.push(text); },
  });
  await session.push("short");
  expect(sent).toEqual([]);
  clock.advance(999);
  await Promise.resolve();
  expect(sent).toEqual([]);
  clock.advance(1);
  await Promise.resolve(); await Promise.resolve();
  expect(sent).toEqual(["short"]);
});

test("merge-text defers flush when single chunk has unclosed fence even if over minChars", async () => {
  const sent: string[] = [];
  const clock = createManualClock();
  const session = createOutboundQueueSession({
    strategy: "merge-text",
    minChars: 5,
    maxChars: 1000,
    idleMs: 5000,
    schedule: clock.schedule,
    sendText: async (text) => { sent.push(text); },
  });
  // Open fence; buffer is over minChars but fence is still open → must wait.
  await session.push("```ts\nconst x = 1;\nconst y = 2;\nconst z = 3;");
  expect(sent).toEqual([]);
  // Close the fence; now safe to send.
  await session.push("\n```");
  expect(sent).toHaveLength(1);
  expect(sent[0]).toContain("```ts");
  expect(sent[0]!.endsWith("```")).toBe(true);
});

test("merge-text defers flush when single chunk ends with a partial table row", async () => {
  const sent: string[] = [];
  const clock = createManualClock();
  const session = createOutboundQueueSession({
    strategy: "merge-text",
    minChars: 5,
    maxChars: 1000,
    idleMs: 5000,
    schedule: clock.schedule,
    sendText: async (text) => { sent.push(text); },
  });
  await session.push("| a | b |\n|---|---|\n| 1 | 2 |");
  expect(sent).toEqual([]);
  await session.push("\nparagraph after table.");
  await session.flush();
  expect(sent).toHaveLength(1);
  expect(sent[0]).toContain("| 1 | 2 |");
  expect(sent[0]).toContain("paragraph after table.");
});

test("merge-on-flush sends nothing until flush() (disableBlockStreaming case)", async () => {
  const sent: string[] = [];
  const session = createOutboundQueueSession({
    strategy: "merge-on-flush",
    minChars: 1,
    maxChars: 1000,
    idleMs: 5000,
    sendText: async (text) => { sent.push(text); },
  });
  await session.push("part1");
  await session.push("part2");
  expect(sent).toEqual([]);
  await session.flush();
  expect(sent).toEqual(["part1part2"]);
});

test("merge-text restores separators between streamed markdown blocks", async () => {
  const sent: string[] = [];
  const session = createOutboundQueueSession({
    strategy: "merge-text",
    minChars: 100,
    maxChars: 1000,
    idleMs: 0,
    sendText: async (text) => { sent.push(text); },
  });
  await session.push("Intro");
  await session.push("```ts\nconst x = 1;\n```");
  await session.flush();
  expect(sent).toEqual(["Intro\n\n```ts\nconst x = 1;\n```"]);
});

test("merge-text heals blank-line-fragmented markdown tables before sending", async () => {
  const sent: string[] = [];
  const session = createOutboundQueueSession({
    strategy: "merge-text",
    minChars: 1,
    maxChars: 1000,
    idleMs: 0,
    sendText: async (text) => { sent.push(text); },
  });
  await session.push("| 模型 |");
  await session.push("得分 |\n|---|---|\n| A |");
  await session.push("95 |");
  await session.flush();
  expect(sent).toEqual(["| 模型 | 得分 |\n|---|---|\n| A | 95 |"]);
});

test("abort drops buffered text and prevents further sends", async () => {
  const sent: string[] = [];
  const clock = createManualClock();
  const session = createOutboundQueueSession({
    strategy: "merge-text",
    minChars: 100,
    maxChars: 200,
    idleMs: 1000,
    schedule: clock.schedule,
    sendText: async (text) => { sent.push(text); },
  });
  await session.push("buffered");
  session.abort();
  await session.push("after abort");
  await session.flush();
  expect(sent).toEqual([]);
});

test("isAborted callback suppresses sends without dropping buffer", async () => {
  const sent: string[] = [];
  let aborted = false;
  const session = createOutboundQueueSession({
    strategy: "merge-text",
    minChars: 1,
    maxChars: 100,
    idleMs: 0,
    isAborted: () => aborted,
    sendText: async (text) => { sent.push(text); },
  });
  aborted = true;
  await session.push("hello");
  await session.flush();
  expect(sent).toEqual([]);
});

test("merge-text honours chunkText override (e.g. overflowPolicy: stop)", async () => {
  const session = createOutboundQueueSession({
    strategy: "merge-text",
    minChars: 1,
    maxChars: 5,
    idleMs: 0,
    chunkText: (text, max) => {
      if (text.length > max) throw new Error(`overflow: ${text.length} > ${max}`);
      return [text];
    },
    sendText: async () => {},
  });
  await expect(session.push("too long for cap").catch((e) => e.message)).resolves.toContain("overflow");
});
