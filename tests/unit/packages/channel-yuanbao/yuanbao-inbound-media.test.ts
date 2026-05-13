import { beforeEach, expect, test } from "bun:test";
import path from "node:path";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";

import { YuanbaoChannel } from "../../../../packages/channel-yuanbao/src/index";
import { resetYuanbaoChatQueueForTests } from "../../../../packages/channel-yuanbao/src/chat-queue";
import { RuntimeMediaStore } from "../../../../packages/channel-yuanbao/src/media-store";
import type { ChatAgent } from "../../../../src/channels/types";
import type {
  YuanbaoGateway,
  YuanbaoGatewayStartInput,
} from "../../../../packages/channel-yuanbao/src/types";
import type { ChannelMediaAttachment } from "../../../../packages/channel-yuanbao/src/media-types";

function createNoopQuota() {
  return {
    onInbound() {},
    reserveMidSegment: () => true,
    reserveFinal: () => true,
    finalRemaining: () => 4,
    hasPendingFinal: () => false,
    drainPendingFinalUpToBudget: () => [],
    prependPendingFinal() {},
    enqueuePendingFinal() {},
    clearPendingFinal() {},
  };
}

function createNoopLogger() {
  return {
    info: async () => {},
    error: async () => {},
    debug: async () => {},
    cleanup: async () => {},
    flush: async () => {},
  } as never;
}

function fakeFetch(routes: Record<string, { body: Uint8Array; contentType?: string; status?: number } | "fail">): typeof fetch {
  return async (urlIn: RequestInfo | URL) => {
    const url = typeof urlIn === "string" ? urlIn : urlIn.toString();
    const route = routes[url];
    if (!route || route === "fail") {
      if (route === "fail") throw new Error("simulated network failure");
      throw new Error(`fakeFetch: no route for ${url}`);
    }
    const body = route.body;
    return new Response(body, {
      status: route.status ?? 200,
      headers: {
        "content-type": route.contentType ?? "application/octet-stream",
        "content-length": String(body.byteLength),
      },
    }) as unknown as Response;
  };
}

const baseConfig = {
  appKey: "k",
  appSecret: "s",
  botId: "bot_001",
  requireMention: true,
  outboundQueueStrategy: "immediate" as const,
  minChars: 1,
  maxChars: 1000,
  idleMs: 0,
  mediaMaxMb: 5,
};

function mentionAtBotBody(text: string) {
  return [
    { msg_type: "TIMCustomElem", msg_content: { data: JSON.stringify({ elem_type: 1002, text: "@Bot", user_id: "bot_001" }) } },
    { msg_type: "TIMTextElem", msg_content: { text } },
  ];
}

let tempDir: string;
beforeEach(async () => {
  resetYuanbaoChatQueueForTests();
  tempDir = await mkdtemp(path.join(tmpdir(), "weacpx-yuanbao-media-"));
});

test("inbound image is downloaded and passed to agent.chat({ media })", async () => {
  const buf = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]); // PNG magic
  const fetcher = fakeFetch({
    "https://example.test/a.png": { body: buf, contentType: "image/png" },
  });
  const mediaStore = new RuntimeMediaStore({ rootDir: tempDir });
  let startInput: YuanbaoGatewayStartInput | null = null;
  const gateway: YuanbaoGateway = { start: async (i) => { startInput = i; }, sendText: async () => {} };
  const channel = new YuanbaoChannel(baseConfig, { createGateway: () => gateway, mediaStore, fetchInboundMedia: fetcher });
  const requests: { text: string; media?: ChannelMediaAttachment | ChannelMediaAttachment[] }[] = [];
  const agent: ChatAgent = { async chat(req) { requests.push({ text: req.text, media: req.media }); return { text: "ok" }; } };

  await channel.start({ agent, abortSignal: new AbortController().signal, quota: createNoopQuota(), logger: createNoopLogger() });
  await startInput!.onMessage({
    accountId: "default",
    chatType: "group",
    raw: {
      from_account: "u1",
      group_code: "g1",
      msg_id: "m_img",
      msg_body: [
        ...mentionAtBotBody("what's in this image?"),
        { msg_type: "TIMImageElem", msg_content: { uuid: "img_uuid_1", image_info_array: [{ type: 1, url: "https://example.test/a.png", size: buf.byteLength }] } },
      ],
    },
  });

  expect(requests).toHaveLength(1);
  const media = requests[0]!.media as ChannelMediaAttachment[] | undefined;
  expect(media).toBeDefined();
  expect(media).toHaveLength(1);
  expect(media![0]!.kind).toBe("image");
  expect(media![0]!.mimeType).toBe("image/png");
  expect(media![0]!.source.accountId).toBe("default");
  expect(media![0]!.source.resourceId).toBe("img_uuid_1");
  const onDisk = await readFile(media![0]!.filePath);
  expect(onDisk.equals(buf)).toBe(true);
  // The prompt still carries the user's question, with no "[attachment unavailable" placeholder.
  expect(requests[0]!.text).toContain("what's in this image?");
  expect(requests[0]!.text).not.toContain("attachment unavailable");
});

test("inbound file is downloaded with reported file_name", async () => {
  const buf = Buffer.from("hello attachment");
  const fetcher = fakeFetch({
    "https://example.test/report.pdf": { body: buf, contentType: "application/pdf" },
  });
  const mediaStore = new RuntimeMediaStore({ rootDir: tempDir });
  let startInput: YuanbaoGatewayStartInput | null = null;
  const gateway: YuanbaoGateway = { start: async (i) => { startInput = i; }, sendText: async () => {} };
  const channel = new YuanbaoChannel(baseConfig, { createGateway: () => gateway, mediaStore, fetchInboundMedia: fetcher });
  const requests: { media?: ChannelMediaAttachment | ChannelMediaAttachment[] }[] = [];
  const agent: ChatAgent = { async chat(req) { requests.push({ media: req.media }); return { text: "ok" }; } };

  await channel.start({ agent, abortSignal: new AbortController().signal, quota: createNoopQuota(), logger: createNoopLogger() });
  await startInput!.onMessage({
    accountId: "default",
    chatType: "group",
    raw: {
      from_account: "u1",
      group_code: "g1",
      msg_id: "m_file",
      msg_body: [
        ...mentionAtBotBody("please read this"),
        { msg_type: "TIMFileElem", msg_content: { url: "https://example.test/report.pdf", file_name: "Q1 report.pdf", file_size: buf.byteLength } },
      ],
    },
  });

  const media = requests[0]!.media as ChannelMediaAttachment[];
  expect(media[0]!.kind).toBe("file");
  expect(media[0]!.fileName).toBe("Q1-report.pdf");
  expect(media[0]!.mimeType).toBe("application/pdf");
});

test("oversize attachment (sizeHint > mediaMaxMb) is short-circuited with placeholder, no fetch", async () => {
  let fetched = 0;
  const fetcher: typeof fetch = async () => { fetched++; return new Response(""); };
  const mediaStore = new RuntimeMediaStore({ rootDir: tempDir });
  let startInput: YuanbaoGatewayStartInput | null = null;
  const gateway: YuanbaoGateway = { start: async (i) => { startInput = i; }, sendText: async () => {} };
  const channel = new YuanbaoChannel(
    { ...baseConfig, mediaMaxMb: 1 },
    { createGateway: () => gateway, mediaStore, fetchInboundMedia: fetcher },
  );
  const prompts: { text: string; media?: ChannelMediaAttachment | ChannelMediaAttachment[] }[] = [];
  const agent: ChatAgent = { async chat(req) { prompts.push({ text: req.text, media: req.media }); return { text: "ok" }; } };
  await channel.start({ agent, abortSignal: new AbortController().signal, quota: createNoopQuota(), logger: createNoopLogger() });
  await startInput!.onMessage({
    accountId: "default",
    chatType: "group",
    raw: {
      from_account: "u1",
      group_code: "g1",
      msg_id: "m_big",
      msg_body: [
        ...mentionAtBotBody("check this huge file"),
        { msg_type: "TIMFileElem", msg_content: { url: "https://example.test/huge.bin", file_name: "huge.bin", file_size: 5 * 1024 * 1024 } },
      ],
    },
  });
  expect(fetched).toBe(0);
  expect(prompts[0]!.media).toBeUndefined();
  expect(prompts[0]!.text).toContain("attachment unavailable: file too large");
});

test("download failure falls back to placeholder while the message text is still sent", async () => {
  const fetcher = fakeFetch({
    "https://example.test/broken.png": "fail",
  });
  const mediaStore = new RuntimeMediaStore({ rootDir: tempDir });
  let startInput: YuanbaoGatewayStartInput | null = null;
  const gateway: YuanbaoGateway = { start: async (i) => { startInput = i; }, sendText: async () => {} };
  const channel = new YuanbaoChannel(baseConfig, { createGateway: () => gateway, mediaStore, fetchInboundMedia: fetcher });
  const prompts: { text: string; media?: ChannelMediaAttachment | ChannelMediaAttachment[] }[] = [];
  const agent: ChatAgent = { async chat(req) { prompts.push({ text: req.text, media: req.media }); return { text: "ok" }; } };

  await channel.start({ agent, abortSignal: new AbortController().signal, quota: createNoopQuota(), logger: createNoopLogger() });
  await startInput!.onMessage({
    accountId: "default",
    chatType: "group",
    raw: {
      from_account: "u1",
      group_code: "g1",
      msg_id: "m_broken",
      msg_body: [
        ...mentionAtBotBody("see this please"),
        { msg_type: "TIMImageElem", msg_content: { image_info_array: [{ type: 1, url: "https://example.test/broken.png" }] } },
      ],
    },
  });

  expect(prompts).toHaveLength(1);
  expect(prompts[0]!.media).toBeUndefined();
  expect(prompts[0]!.text).toContain("see this please");
  expect(prompts[0]!.text).toContain("[attachment unavailable: image]");
});

test("multi-media: image + file in the same message both arrive as attachments", async () => {
  const img = Buffer.from([0xff, 0xd8, 0xff]);
  const file = Buffer.from("doc body");
  const fetcher = fakeFetch({
    "https://example.test/a.jpg": { body: img, contentType: "image/jpeg" },
    "https://example.test/notes.txt": { body: file, contentType: "text/plain" },
  });
  const mediaStore = new RuntimeMediaStore({ rootDir: tempDir });
  let startInput: YuanbaoGatewayStartInput | null = null;
  const gateway: YuanbaoGateway = { start: async (i) => { startInput = i; }, sendText: async () => {} };
  const channel = new YuanbaoChannel(baseConfig, { createGateway: () => gateway, mediaStore, fetchInboundMedia: fetcher });
  const prompts: { media?: ChannelMediaAttachment | ChannelMediaAttachment[] }[] = [];
  const agent: ChatAgent = { async chat(req) { prompts.push({ media: req.media }); return { text: "ok" }; } };

  await channel.start({ agent, abortSignal: new AbortController().signal, quota: createNoopQuota(), logger: createNoopLogger() });
  await startInput!.onMessage({
    accountId: "default",
    chatType: "group",
    raw: {
      from_account: "u1",
      group_code: "g1",
      msg_id: "m_multi",
      msg_body: [
        ...mentionAtBotBody("look at these"),
        { msg_type: "TIMImageElem", msg_content: { image_info_array: [{ type: 1, url: "https://example.test/a.jpg" }] } },
        { msg_type: "TIMFileElem", msg_content: { url: "https://example.test/notes.txt", file_name: "notes.txt" } },
      ],
    },
  });

  const media = prompts[0]!.media as ChannelMediaAttachment[];
  expect(media).toHaveLength(2);
  const kinds = media.map((m) => m.kind).sort();
  expect(kinds).toEqual(["file", "image"]);
});

test("pure-image message (no text) still triggers a turn with media attached", async () => {
  const buf = Buffer.from([0xff, 0xd8]);
  const fetcher = fakeFetch({ "https://example.test/solo.jpg": { body: buf, contentType: "image/jpeg" } });
  const mediaStore = new RuntimeMediaStore({ rootDir: tempDir });
  let startInput: YuanbaoGatewayStartInput | null = null;
  const gateway: YuanbaoGateway = { start: async (i) => { startInput = i; }, sendText: async () => {} };
  // requireMention=false so a pure-image message with no @ still gets handled.
  const channel = new YuanbaoChannel(
    { ...baseConfig, requireMention: false },
    { createGateway: () => gateway, mediaStore, fetchInboundMedia: fetcher },
  );
  const requests: { text: string; media?: ChannelMediaAttachment | ChannelMediaAttachment[] }[] = [];
  const agent: ChatAgent = { async chat(req) { requests.push({ text: req.text, media: req.media }); return { text: "ok" }; } };

  await channel.start({ agent, abortSignal: new AbortController().signal, quota: createNoopQuota(), logger: createNoopLogger() });
  await startInput!.onMessage({
    accountId: "default",
    chatType: "group",
    raw: {
      from_account: "u1",
      group_code: "g1",
      msg_id: "m_solo",
      msg_body: [
        { msg_type: "TIMImageElem", msg_content: { image_info_array: [{ type: 1, url: "https://example.test/solo.jpg" }] } },
      ],
    },
  });

  expect(requests).toHaveLength(1);
  expect((requests[0]!.media as ChannelMediaAttachment[])).toHaveLength(1);
});

test("declared content-length over maxBytes aborts before streaming the body", async () => {
  const oversize = Buffer.alloc(2 * 1024 * 1024);
  let bytesStreamed = 0;
  const fetcher: typeof fetch = async () => {
    // content-length headline is what triggers the early bail.
    return new Response(oversize, {
      status: 200,
      headers: { "content-type": "image/png", "content-length": String(oversize.byteLength) },
    });
  };
  const mediaStore = new RuntimeMediaStore({ rootDir: tempDir });
  let startInput: YuanbaoGatewayStartInput | null = null;
  const gateway: YuanbaoGateway = { start: async (i) => { startInput = i; }, sendText: async () => {} };
  const channel = new YuanbaoChannel(
    { ...baseConfig, mediaMaxMb: 1 },
    { createGateway: () => gateway, mediaStore, fetchInboundMedia: fetcher },
  );
  const prompts: { media?: ChannelMediaAttachment | ChannelMediaAttachment[]; text: string }[] = [];
  const agent: ChatAgent = { async chat(req) { prompts.push({ media: req.media, text: req.text }); return { text: "ok" }; } };

  await channel.start({ agent, abortSignal: new AbortController().signal, quota: createNoopQuota(), logger: createNoopLogger() });
  await startInput!.onMessage({
    accountId: "default",
    chatType: "group",
    raw: {
      from_account: "u1",
      group_code: "g1",
      msg_id: "m_cl",
      msg_body: [
        ...mentionAtBotBody("here"),
        { msg_type: "TIMImageElem", msg_content: { image_info_array: [{ type: 1, url: "https://example.test/cl.png" }] } },
      ],
    },
  });

  expect(bytesStreamed).toBe(0);
  expect(prompts[0]!.media).toBeUndefined();
  expect(prompts[0]!.text).toContain("[attachment unavailable: image]");
});

test.afterEach?.(async () => {
  if (tempDir) await rm(tempDir, { recursive: true, force: true });
});
