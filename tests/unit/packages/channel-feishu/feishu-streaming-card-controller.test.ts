import { beforeEach, expect, test } from "bun:test";

import {
  StreamingCardController,
  type StreamingCardClient,
} from "../../../../packages/channel-feishu/src/card/streaming-card-controller";
import {
  isMessageUnavailable,
  markMessageUnavailable,
  resetMessageUnavailableCacheForTests,
} from "../../../../packages/channel-feishu/src/message-unavailable";

beforeEach(() => {
  resetMessageUnavailableCacheForTests();
});

interface FakeClientCalls {
  cardCreate: Array<{ data: string }>;
  cardUpdate: Array<{ cardId: string; sequence: number; cardJson: Record<string, unknown> }>;
  elementContent: Array<{ cardId: string; elementId: string; content: string; sequence: number }>;
  messageReply: Array<{ replyTo: string; content: string }>;
  messageCreate: Array<{ receiveIdType: string; receiveId: string; content: string }>;
}

function createFakeClient(options: { failReply?: unknown; failUpdate?: unknown; omitElementApi?: boolean; failElement?: unknown } = {}): { client: StreamingCardClient; calls: FakeClientCalls } {
  const calls: FakeClientCalls = {
    cardCreate: [],
    cardUpdate: [],
    elementContent: [],
    messageReply: [],
    messageCreate: [],
  };
  let createSeq = 0;
  const client: StreamingCardClient = {
    cardkit: {
      v1: {
        card: {
          create: async (input) => {
            calls.cardCreate.push({ data: input.data.data });
            createSeq += 1;
            return { data: { card_id: `card_${createSeq}` } };
          },
          update: async (input) => {
            if (options.failUpdate) throw options.failUpdate;
            calls.cardUpdate.push({
              cardId: input.path.card_id,
              sequence: input.data.sequence,
              cardJson: JSON.parse(input.data.card.data) as Record<string, unknown>,
            });
            return {};
          },
        },
        ...(options.omitElementApi
          ? {}
          : {
              cardElement: {
                content: async (input) => {
                  if (options.failElement) throw options.failElement;
                  calls.elementContent.push({
                    cardId: input.path.card_id,
                    elementId: input.path.element_id,
                    content: input.data.content,
                    sequence: input.data.sequence,
                  });
                  return {};
                },
              },
            }),
      },
    },
    im: {
      message: {
        reply: async (input) => {
          if (options.failReply) throw options.failReply;
          calls.messageReply.push({ replyTo: input.path.message_id, content: input.data.content });
          return { data: { message_id: "om_card", chat_id: "oc_chat" } };
        },
        create: async (input) => {
          calls.messageCreate.push({
            receiveIdType: input.params.receive_id_type,
            receiveId: input.data.receive_id,
            content: input.data.content,
          });
          return { data: { message_id: "om_card_fresh", chat_id: "oc_chat" } };
        },
      },
    },
  };
  return { client, calls };
}

test("seed uses reply path when replyToMessageId is provided and available", async () => {
  const { client, calls } = createFakeClient();
  const controller = new StreamingCardController({ client, flushIntervalMs: 10 });
  const result = await controller.seed({ to: "oc_chat", replyToMessageId: "om_in" });

  expect(calls.cardCreate).toHaveLength(1);
  expect(calls.messageReply).toHaveLength(1);
  expect(calls.messageReply[0].replyTo).toBe("om_in");
  expect(calls.messageCreate).toHaveLength(0);
  expect(result.cardId).toBe("card_1");
  expect(result.messageId).toBe("om_card");
});

test("seed falls back to fresh send when reply fails", async () => {
  const { client, calls } = createFakeClient({ failReply: new Error("forbidden") });
  const controller = new StreamingCardController({ client, flushIntervalMs: 10 });
  const result = await controller.seed({ to: "oc_chat", replyToMessageId: "om_in" });

  expect(calls.messageCreate).toHaveLength(1);
  expect(result.messageId).toBe("om_card_fresh");
});

test("seed ignores unavailable mark from a different account scope", async () => {
  // A different bot marked om_in as recalled. Our bot (account "a") should
  // still attempt the reply path because the cache is scoped per account.
  markMessageUnavailable("om_in", 230011, "b");
  const { client, calls } = createFakeClient();
  const controller = new StreamingCardController({
    client,
    flushIntervalMs: 10,
    accountId: "a",
  });
  await controller.seed({ to: "oc_chat", replyToMessageId: "om_in" });
  expect(calls.messageReply).toHaveLength(1);
  expect(calls.messageCreate).toHaveLength(0);
});

test("seed honors unavailable mark from the same account scope", async () => {
  markMessageUnavailable("om_in", 231003, "a");
  const { client, calls } = createFakeClient();
  const controller = new StreamingCardController({
    client,
    flushIntervalMs: 10,
    accountId: "a",
  });
  await controller.seed({ to: "oc_chat", replyToMessageId: "om_in" });
  expect(calls.messageReply).toHaveLength(0);
  expect(calls.messageCreate).toHaveLength(1);
});

test("seed reply failure marks unavailable under the controller's account scope", async () => {
  const err = { code: 230011, msg: "recalled" };
  const { client } = createFakeClient({ failReply: err });
  const controller = new StreamingCardController({
    client,
    flushIntervalMs: 10,
    accountId: "a",
  });
  await controller.seed({ to: "oc_chat", replyToMessageId: "om_in" });
  expect(isMessageUnavailable("om_in", "a")).toBe(true);
  expect(isMessageUnavailable("om_in", "b")).toBe(false);
  expect(isMessageUnavailable("om_in")).toBe(false);
});

test("first terminal transition wins; subsequent complete/abort/fail are no-ops", async () => {
  const { client, calls } = createFakeClient();
  const controller = new StreamingCardController({ client, flushIntervalMs: 5 });
  await controller.seed({ to: "oc_chat" });
  controller.appendStream("partial");
  // Fire abort then complete back-to-back. The synchronous transitionTo step
  // in abort flips state to "aborted" before complete runs, so complete must
  // become a no-op.
  const a = controller.abort("stopped");
  const b = controller.complete("ignored final");
  await Promise.all([a, b]);
  const last = calls.cardUpdate[calls.cardUpdate.length - 1];
  const summary = (last.cardJson as { config?: { summary?: { i18n_content?: Record<string, string> } } })
    .config?.summary?.i18n_content;
  expect(summary?.zh_cn ?? "").toBe("已停止");
  // Body should preserve the abort message, not the ignored complete text.
  const bodyElements = (last.cardJson as { body?: { elements?: Array<Record<string, unknown>> } }).body?.elements ?? [];
  const streamingElement = bodyElements.find((el) => (el as { element_id?: string }).element_id === "streaming_content");
  expect((streamingElement as { content?: string } | undefined)?.content).toBe("stopped");
});

test("appendStream after complete is rejected", async () => {
  const { client, calls } = createFakeClient();
  const controller = new StreamingCardController({ client, flushIntervalMs: 5 });
  await controller.seed({ to: "oc_chat" });
  await controller.complete("done");
  const updatesBefore = calls.cardUpdate.length;
  controller.appendStream("zombie chunk");
  // Give any errant flush a chance to fire.
  await new Promise((r) => setTimeout(r, 20));
  expect(calls.cardUpdate.length).toBe(updatesBefore);
});

test("appendStream coalesces rapid chunks and complete force-flushes with final state", async () => {
  const { client, calls } = createFakeClient();
  const controller = new StreamingCardController({ client, flushIntervalMs: 30 });
  await controller.seed({ to: "oc_chat" });

  controller.appendStream("hel");
  controller.appendStream("lo ");
  controller.appendStream("world");

  await controller.complete();

  expect(calls.cardUpdate.length).toBeGreaterThanOrEqual(1);
  const last = calls.cardUpdate[calls.cardUpdate.length - 1];
  expect((last.cardJson.config as { streaming_mode: boolean }).streaming_mode).toBe(false);
  expect((last.cardJson.config as { summary: { content: string } }).summary.content).toBe("Done");
  const elements = (last.cardJson.body as { elements: Array<{ content: string }> }).elements;
  expect(elements[0].content).toBe("hello world");
});

test("complete with explicit finalText overwrites buffer", async () => {
  const { client, calls } = createFakeClient();
  const controller = new StreamingCardController({ client, flushIntervalMs: 30 });
  await controller.seed({ to: "oc_chat" });

  controller.appendStream("intermediate");
  await controller.complete("final answer");

  const last = calls.cardUpdate[calls.cardUpdate.length - 1];
  const elements = (last.cardJson.body as { elements: Array<{ content: string }> }).elements;
  expect(elements[0].content).toBe("final answer");
});

test("abort emits an 'aborted' final-state card", async () => {
  const { client, calls } = createFakeClient();
  const controller = new StreamingCardController({ client, flushIntervalMs: 30 });
  await controller.seed({ to: "oc_chat" });

  controller.appendStream("partial");
  await controller.abort();

  const last = calls.cardUpdate[calls.cardUpdate.length - 1];
  expect((last.cardJson.config as { summary: { content: string } }).summary.content).toBe("Stopped");
  const elements = (last.cardJson.body as { elements: Array<{ content: string }> }).elements;
  expect(elements[0].content).toBe("partial");
  expect(elements[1].content).toContain("已停止");
});

test("once terminated, subsequent appends are no-ops", async () => {
  const { client, calls } = createFakeClient();
  const controller = new StreamingCardController({ client, flushIntervalMs: 30 });
  await controller.seed({ to: "oc_chat" });

  controller.appendStream("a");
  await controller.complete("done");
  const updatesAfterComplete = calls.cardUpdate.length;

  controller.appendStream("ignored");
  await controller.waitIdle();
  expect(calls.cardUpdate.length).toBe(updatesAfterComplete);
});

test("card.update errors are swallowed", async () => {
  const { client } = createFakeClient({ failUpdate: new Error("network") });
  const controller = new StreamingCardController({ client, flushIntervalMs: 10 });
  await controller.seed({ to: "oc_chat" });

  controller.appendStream("a");
  await expect(controller.complete("final")).resolves.toBeUndefined();
});

test("repeated card.update failures fire onCardDegraded with the buffered text", async () => {
  const degradeCalls: Array<{ buffer: string; consecutiveFailures: number }> = [];
  const { client } = createFakeClient({ failUpdate: new Error("network") });
  const controller = new StreamingCardController({
    client,
    flushIntervalMs: 5,
    failureThreshold: 3,
    onCardDegraded: (input) => degradeCalls.push(input),
  });
  await controller.seed({ to: "oc_chat" });
  for (let i = 0; i < 5; i++) {
    controller.appendStream(`chunk${i}`);
    await new Promise((r) => setTimeout(r, 15));
  }
  await controller.complete("final answer text");
  expect(controller.isDegraded()).toBe(true);
  expect(degradeCalls.length).toBe(1);
  expect(degradeCalls[0].consecutiveFailures).toBeGreaterThanOrEqual(3);
  expect(degradeCalls[0].buffer.length).toBeGreaterThan(0);
});

test("recalled (230011) update errors do not count as failures", async () => {
  const degradeCalls: number[] = [];
  const recalledError = { code: 230011, msg: "recalled" };
  const { client } = createFakeClient({ failUpdate: recalledError });
  const controller = new StreamingCardController({
    client,
    flushIntervalMs: 5,
    failureThreshold: 2,
    onCardDegraded: () => degradeCalls.push(1),
  });
  await controller.seed({ to: "oc_chat" });
  controller.appendStream("a");
  await new Promise((r) => setTimeout(r, 15));
  controller.appendStream("b");
  await new Promise((r) => setTimeout(r, 15));
  controller.appendStream("c");
  await controller.complete("done");
  // Once marked unavailable, pushUpdate short-circuits and doesn't even try
  // the update — so neither path counts. Degraded callback must not fire.
  expect(degradeCalls).toEqual([]);
  expect(controller.isDegraded()).toBe(false);
});

test("subsequent streaming pushes use cardElement.content (not full card.update)", async () => {
  const { client, calls } = createFakeClient();
  const controller = new StreamingCardController({ client, flushIntervalMs: 10 });
  await controller.seed({ to: "oc_chat" });

  controller.appendStream("first");
  await new Promise((r) => setTimeout(r, 30));
  controller.appendStream(" second");
  await new Promise((r) => setTimeout(r, 30));
  await controller.complete();

  // First streaming push goes through card.update (transitioning thinking→streaming);
  // subsequent pure-text pushes go through cardElement.content; complete is a full card.update again.
  expect(calls.cardUpdate.length).toBeGreaterThanOrEqual(2);
  expect(calls.elementContent.length).toBeGreaterThanOrEqual(1);
  const lastElement = calls.elementContent[calls.elementContent.length - 1];
  expect(lastElement.elementId).toBe("streaming_content");
  expect(lastElement.content).toContain("first second");
});

test("falls back to full card.update when cardElement.content is unavailable", async () => {
  const { client, calls } = createFakeClient({ omitElementApi: true });
  const controller = new StreamingCardController({ client, flushIntervalMs: 10 });
  await controller.seed({ to: "oc_chat" });

  controller.appendStream("first");
  await new Promise((r) => setTimeout(r, 30));
  controller.appendStream(" second");
  await new Promise((r) => setTimeout(r, 30));
  await controller.complete();

  expect(calls.elementContent).toHaveLength(0);
  expect(calls.cardUpdate.length).toBeGreaterThanOrEqual(2);
});

test("falls back to full card.update when cardElement.content throws", async () => {
  const { client, calls } = createFakeClient({ failElement: new Error("element gone") });
  const controller = new StreamingCardController({ client, flushIntervalMs: 10 });
  await controller.seed({ to: "oc_chat" });

  controller.appendStream("a");
  await new Promise((r) => setTimeout(r, 30));
  controller.appendStream("b");
  await new Promise((r) => setTimeout(r, 30));
  await controller.complete();

  // element call attempted but failed; card.update should have been used as fallback.
  expect(calls.cardUpdate.length).toBeGreaterThanOrEqual(2);
});

test("complete final card includes elapsed footer", async () => {
  const { client, calls } = createFakeClient();
  let t = 1_000;
  const controller = new StreamingCardController({ client, flushIntervalMs: 5, now: () => t });
  await controller.seed({ to: "oc_chat" });
  t += 2_500; // simulate 2.5s passing
  controller.appendStream("hello");
  await controller.complete();

  const last = calls.cardUpdate[calls.cardUpdate.length - 1];
  const body = last.cardJson.body as { elements: Array<{ content: string }> };
  expect(body.elements[1].content).toContain("已完成");
  expect(body.elements[1].content).toContain("2.5s");
});

test("aborted card includes elapsed footer", async () => {
  const { client, calls } = createFakeClient();
  let t = 5_000;
  const controller = new StreamingCardController({ client, flushIntervalMs: 5, now: () => t });
  await controller.seed({ to: "oc_chat" });
  t += 750;
  await controller.abort();

  const last = calls.cardUpdate[calls.cardUpdate.length - 1];
  const body = last.cardJson.body as { elements: Array<{ content: string }> };
  expect(body.elements[1].content).toContain("已停止");
  expect(body.elements[1].content).toContain("750ms");
});

test("complete with <think> tags renders reasoning above the answer", async () => {
  const { client, calls } = createFakeClient();
  const controller = new StreamingCardController({ client, flushIntervalMs: 5 });
  await controller.seed({ to: "oc_chat" });
  await controller.complete("<think>balancing tradeoffs</think>Use option B.");

  const last = calls.cardUpdate[calls.cardUpdate.length - 1];
  const body = last.cardJson.body as { elements: Array<{ tag: string; element_id?: string; content: string }> };
  // [reasoning markdown, hr, answer markdown, footer?]
  expect(body.elements[0].element_id).toBe("reasoning_content");
  expect(body.elements[0].content).toContain("balancing tradeoffs");
  expect(body.elements[1].tag).toBe("hr");
  expect(body.elements[2].element_id).toBe("streaming_content");
  expect(body.elements[2].content).toBe("Use option B.");
});

test("complete with plain text has no reasoning element", async () => {
  const { client, calls } = createFakeClient();
  const controller = new StreamingCardController({ client, flushIntervalMs: 5 });
  await controller.seed({ to: "oc_chat" });
  await controller.complete("just the answer");

  const last = calls.cardUpdate[calls.cardUpdate.length - 1];
  const body = last.cardJson.body as { elements: Array<{ tag: string; element_id?: string; content: string }> };
  // No reasoning_content present
  expect(body.elements.find((e) => e.element_id === "reasoning_content")).toBeUndefined();
  const answer = body.elements.find((e) => e.element_id === "streaming_content");
  expect(answer?.content).toBe("just the answer");
});

test("complete() with empty text still renders complete-state card", async () => {
  const { client, calls } = createFakeClient();
  const controller = new StreamingCardController({ client, flushIntervalMs: 5 });
  await controller.seed({ to: "oc_chat" });
  await controller.complete("");

  const final = calls.cardUpdate[calls.cardUpdate.length - 1];
  expect((final.cardJson.config as { streaming_mode: boolean }).streaming_mode).toBe(false);
  expect((final.cardJson.config as { summary: { content: string } }).summary.content).toBe("Done");
});

test("fail() preserves partial streamed buffer", async () => {
  const { client, calls } = createFakeClient();
  const controller = new StreamingCardController({ client, flushIntervalMs: 5 });
  await controller.seed({ to: "oc_chat" });
  controller.appendStream("partial output so far");
  await controller.fail("network exploded");

  const last = calls.cardUpdate[calls.cardUpdate.length - 1];
  const body = last.cardJson.body as { elements: Array<{ content: string }> };
  expect(body.elements[0].content).toContain("partial output so far");
  expect(body.elements[0].content).toContain("network exploded");
});

test("complete() awaits image upload so final card carries the resolved image_key", async () => {
  const { client, calls } = createFakeClient();
  let imgCounter = 0;
  // Attach im.image.create to the fake client so the resolver can upload.
  (client.im as unknown as { image: { create: (input: { data: { image_type: string; image: unknown } }) => Promise<unknown> } }).image = {
    create: async () => {
      imgCounter += 1;
      return { data: { image_key: `img_${imgCounter}` } };
    },
  };

  const controller = new StreamingCardController({
    client,
    flushIntervalMs: 5,
    imageResolveTimeoutMs: 500,
    fetchUrl: async () => Buffer.from([0xff, 0xd8, 0xff]),
  });
  await controller.seed({ to: "oc_chat" });

  controller.appendStream("see this image: ![cat](https://example.com/cat.png)");
  await controller.complete();

  const final = calls.cardUpdate[calls.cardUpdate.length - 1];
  const body = final.cardJson.body as { elements: Array<{ content: string }> };
  expect(body.elements[0].content).toContain("![cat](img_1)");
  expect(body.elements[0].content).not.toContain("example.com");
});

test("resolveImages=false disables URL resolution entirely", async () => {
  const { client, calls } = createFakeClient();
  (client.im as unknown as { image: { create: (input: { data: { image_type: string; image: unknown } }) => Promise<unknown> } }).image = {
    create: async () => {
      throw new Error("should not be called");
    },
  };
  const controller = new StreamingCardController({
    client,
    flushIntervalMs: 5,
    resolveImages: false,
    fetchUrl: async () => {
      throw new Error("fetchUrl should not be called");
    },
  });
  await controller.seed({ to: "oc_chat" });
  controller.appendStream("![cat](https://example.com/cat.png)");
  await controller.complete();
  // The optimizer's stripInvalidImageKeys safety net will still strip the URL ref,
  // but no upload was attempted.
  expect(calls.cardUpdate.length).toBeGreaterThanOrEqual(1);
});

test("sequence numbers are monotonically increasing", async () => {
  const { client, calls } = createFakeClient();
  const controller = new StreamingCardController({ client, flushIntervalMs: 10 });
  await controller.seed({ to: "oc_chat" });

  controller.appendStream("a");
  await new Promise((r) => setTimeout(r, 30));
  controller.appendStream("b");
  await new Promise((r) => setTimeout(r, 30));
  await controller.complete();

  const sequences = calls.cardUpdate.map((c) => c.sequence);
  for (let i = 1; i < sequences.length; i++) {
    expect(sequences[i]).toBeGreaterThan(sequences[i - 1]);
  }
});

test("cardBodyMaxChars tuning override truncates oversized output", async () => {
  const { client, calls } = createFakeClient();
  const controller = new StreamingCardController({
    client,
    flushIntervalMs: 5,
    cardBodyMaxChars: 100,
  });
  await controller.seed({ to: "oc_chat" });
  const longText = "x".repeat(500);
  await controller.complete(longText);

  const last = calls.cardUpdate[calls.cardUpdate.length - 1];
  const elements = (last.cardJson as { body?: { elements?: Array<Record<string, unknown>> } }).body?.elements ?? [];
  const streaming = elements.find((el) => (el as { element_id?: string }).element_id === "streaming_content");
  const content = (streaming as { content?: string } | undefined)?.content ?? "";
  // Body was capped to ~100 chars (minus truncation marker).
  expect(content.length).toBeLessThan(150);
  expect(content).toContain("(truncated)");
});

test("failureThreshold override fires onCardDegraded after the configured count", async () => {
  const degradeCalls: number[] = [];
  const { client } = createFakeClient({ failUpdate: new Error("net") });
  const controller = new StreamingCardController({
    client,
    flushIntervalMs: 5,
    failureThreshold: 2,
    onCardDegraded: ({ consecutiveFailures }) => degradeCalls.push(consecutiveFailures),
  });
  await controller.seed({ to: "oc_chat" });
  controller.appendStream("a");
  await new Promise((r) => setTimeout(r, 15));
  controller.appendStream("b");
  await new Promise((r) => setTimeout(r, 15));
  await controller.complete("c");
  // Threshold=2 should fire onCardDegraded once consecutive failures hit 2.
  expect(degradeCalls.length).toBe(1);
  expect(degradeCalls[0]).toBeGreaterThanOrEqual(2);
});

test("truncateForCardBody drops marker when maxChars is smaller than the marker", async () => {
  // Re-using the controller path: with maxChars=3, even an empty buffer +
  // marker would be longer. Output must be <= 3.
  const { client, calls } = createFakeClient();
  const controller = new StreamingCardController({
    client,
    flushIntervalMs: 5,
    cardBodyMaxChars: 3,
  });
  await controller.seed({ to: "oc_chat" });
  await controller.complete("abcdefghij");
  const last = calls.cardUpdate[calls.cardUpdate.length - 1];
  const elements = (last.cardJson as { body?: { elements?: Array<Record<string, unknown>> } }).body?.elements ?? [];
  const streaming = elements.find((el) => (el as { element_id?: string }).element_id === "streaming_content");
  const content = (streaming as { content?: string } | undefined)?.content ?? "";
  expect(content.length).toBeLessThanOrEqual(3);
});

test("cardBodyMaxChars also caps the element-content fast-path", async () => {
  const { client, calls } = createFakeClient();
  const controller = new StreamingCardController({
    client,
    flushIntervalMs: 5,
    cardBodyMaxChars: 50,
  });
  await controller.seed({ to: "oc_chat" });
  // First chunk goes through the full card.update path (thinking → streaming).
  controller.appendStream("a".repeat(20));
  await new Promise((r) => setTimeout(r, 15));
  // Second chunk should go through element-content fast-path; with a total
  // buffer now well over 50 chars, the fast-path payload must be capped too.
  controller.appendStream("b".repeat(200));
  await new Promise((r) => setTimeout(r, 15));
  await controller.complete();
  const fastPathContents = calls.elementContent.map((e) => e.content);
  for (const c of fastPathContents) {
    // Strict cap: truncateForCardBody guarantees `result.length <= maxChars`.
    expect(c.length).toBeLessThanOrEqual(50);
  }
});
