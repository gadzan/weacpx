import { expect, test } from "bun:test";

import {
  normalizeFeishuOutboundMentionTags,
  resolveFeishuReceiveIdType,
  sendTextFeishu,
  sendMediaFeishu,
} from "../../../../packages/channel-feishu/src/send";

test("resolveFeishuReceiveIdType detects chat and open ids", () => {
  expect(resolveFeishuReceiveIdType("oc_chat")).toBe("chat_id");
  expect(resolveFeishuReceiveIdType("ou_user")).toBe("open_id");
  expect(resolveFeishuReceiveIdType("unknown")).toBe("open_id");
});

test("normalizeFeishuOutboundMentionTags canonicalizes common at-tag variants", () => {
  expect(normalizeFeishuOutboundMentionTags("<at id=all></at>")).toBe('<at user_id="all">Everyone</at>');
  expect(normalizeFeishuOutboundMentionTags("<at open_id='ou_abc-123'>Alice</at>")).toBe('<at user_id="ou_abc-123">Alice</at>');
  expect(normalizeFeishuOutboundMentionTags('@<at id="ou_abc">Alice</at>')).toBe('<at user_id="ou_abc">Alice</at>');
});

test("sendTextFeishu replies when replyToMessageId exists", async () => {
  const calls: unknown[] = [];
  const client = {
    im: {
      message: {
        reply: async (payload: unknown) => {
          calls.push(payload);
          return { data: { message_id: "om_reply", chat_id: "oc_chat" } };
        },
        create: async () => {
          throw new Error("create should not be called");
        },
      },
    },
  };

  const result = await sendTextFeishu({ client, to: "oc_chat", text: "hello", replyToMessageId: "om_in" });

  expect(result).toEqual({ messageId: "om_reply", chatId: "oc_chat" });
  expect(calls).toEqual([
    {
      path: { message_id: "om_in" },
      data: { msg_type: "text", content: JSON.stringify({ text: "hello" }) },
    },
  ]);
});

test("sendTextFeishu creates a message without replyToMessageId", async () => {
  const calls: unknown[] = [];
  const client = {
    im: {
      message: {
        reply: async () => {
          throw new Error("reply should not be called");
        },
        create: async (payload: unknown) => {
          calls.push(payload);
          return { data: { message_id: "om_new", chat_id: "oc_chat" } };
        },
      },
    },
  };

  const result = await sendTextFeishu({ client, to: "oc_chat", text: "hello" });

  expect(result).toEqual({ messageId: "om_new", chatId: "oc_chat" });
  expect(calls).toEqual([
    {
      params: { receive_id_type: "chat_id" },
      data: { receive_id: "oc_chat", msg_type: "text", content: JSON.stringify({ text: "hello" }) },
    },
  ]);
});

test("sendTextFeishu normalizes outbound mention tags before sending", async () => {
  const calls: unknown[] = [];
  const client = {
    im: {
      message: {
        reply: async () => {
          throw new Error("reply should not be called");
        },
        create: async (payload: unknown) => {
          calls.push(payload);
          return { data: { message_id: "om_new", chat_id: "oc_chat" } };
        },
      },
    },
  };

  await sendTextFeishu({ client, to: "oc_chat", text: "hi <at open_id=ou_user>Alice</at>" });

  expect((calls[0] as { data: { content: string } }).data.content).toBe(JSON.stringify({
    text: 'hi <at user_id="ou_user">Alice</at>',
  }));
});

test("sendMediaFeishu uploads and replies with image", async () => {
  const calls: unknown[] = [];
  const client = {
    im: {
      image: { create: async (input: unknown) => { calls.push(["image.create", input]); return { data: { image_key: "img_uploaded" } }; } },
      message: { reply: async (input: unknown) => { calls.push(["message.reply", input]); return { data: { message_id: "om_out", chat_id: "oc" } }; } },
    },
  } as never;

  const result = await sendMediaFeishu({
    client,
    to: "oc_1",
    media: { kind: "image", filePath: __filename, mimeType: "image/png", fileName: "a.png" },
    replyToMessageId: "om_in",
  });

  expect(result.messageId).toBe("om_out");
  expect(calls[0][0]).toBe("image.create");
  expect(calls[1][0]).toBe("message.reply");
  expect((calls[1][1] as { data: { msg_type: string } }).data.msg_type).toBe("image");
});

test("sendMediaFeishu uploads non-image as file by kind", async () => {
  const calls: unknown[] = [];
  const client = {
    im: {
      file: { create: async (input: unknown) => { calls.push(["file.create", input]); return { data: { file_key: "file_uploaded" } }; } },
      message: { create: async (input: unknown) => { calls.push(["message.create", input]); return { data: { message_id: "om_out", chat_id: "oc" } }; } },
    },
  } as never;

  await sendMediaFeishu({
    client,
    to: "oc_1",
    media: { kind: "file", filePath: __filename, mimeType: "application/pdf", fileName: "report.pdf" },
  });

  expect(calls[0][0]).toBe("file.create");
  expect(calls[1][0]).toBe("message.create");
  expect((calls[1][1] as { data: { msg_type: string } }).data.msg_type).toBe("file");
});

test("sendMediaFeishu extracts image_key from real SDK shape (top-level)", async () => {
  const client = {
    im: {
      image: { create: async () => ({ image_key: "img_real_sdk" }) },
      message: { reply: async () => ({ data: { message_id: "om_out", chat_id: "oc" } }) },
    },
  } as never;

  const result = await sendMediaFeishu({
    client,
    to: "oc_1",
    media: { kind: "image", filePath: __filename, mimeType: "image/png", fileName: "a.png" },
    replyToMessageId: "om_in",
  });

  expect(result.messageId).toBe("om_out");
});

test("sendMediaFeishu extracts file_key from real SDK shape (top-level)", async () => {
  const client = {
    im: {
      file: { create: async () => ({ file_key: "file_real_sdk" }) },
      message: { create: async () => ({ data: { message_id: "om_out", chat_id: "oc" } }) },
    },
  } as never;

  await sendMediaFeishu({
    client,
    to: "oc_1",
    media: { kind: "file", filePath: __filename, mimeType: "application/pdf", fileName: "a.pdf" },
  });
});

test("sendMediaFeishu sends audio with audio msg_type", async () => {
  const calls: unknown[] = [];
  const client = {
    im: {
      file: { create: async (input: unknown) => { calls.push(["file.create", input]); return { data: { file_key: "audio_uploaded" } }; } },
      message: { reply: async (input: unknown) => { calls.push(["message.reply", input]); return { data: { message_id: "om_out", chat_id: "oc" } }; } },
    },
  } as never;

  await sendMediaFeishu({
    client,
    to: "oc_1",
    media: { kind: "audio", filePath: __filename, mimeType: "audio/opus", fileName: "voice.opus" },
    replyToMessageId: "om_in",
  });

  expect((calls[0][1] as { data: { file_type: string } }).data.file_type).toBe("opus");
  expect((calls[1][1] as { data: { msg_type: string } }).data.msg_type).toBe("audio");
});

test("sendMediaFeishu retries transient upload failures", async () => {
  let attempts = 0;
  const client = {
    im: {
      image: {
        create: async () => {
          attempts++;
          if (attempts === 1) throw { status: 503, message: "temporary unavailable" };
          return { data: { image_key: "img_uploaded" } };
        },
      },
      message: { create: async () => ({ data: { message_id: "om_out", chat_id: "oc" } }) },
    },
  } as never;

  const result = await sendMediaFeishu({
    client,
    to: "oc_1",
    media: { kind: "image", filePath: __filename, mimeType: "image/png", fileName: "a.png" },
  });

  expect(result.messageId).toBe("om_out");
  expect(attempts).toBe(2);
});
