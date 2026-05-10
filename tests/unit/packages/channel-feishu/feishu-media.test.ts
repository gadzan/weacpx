import { Readable } from "node:stream";
import { test, expect } from "bun:test";

import { downloadFeishuMessageResource, extractBufferFromFeishuResponse, inferFeishuFileType } from "../../../../packages/channel-feishu/src/media";

test("extractBufferFromFeishuResponse supports Buffer and ArrayBuffer", async () => {
  expect((await extractBufferFromFeishuResponse(Buffer.from("a"))).buffer.toString()).toBe("a");
  expect((await extractBufferFromFeishuResponse(Uint8Array.from([98]).buffer)).buffer.toString()).toBe("b");
});

test("extractBufferFromFeishuResponse supports response data and streams", async () => {
  expect((await extractBufferFromFeishuResponse({ data: Buffer.from("c"), headers: { "content-type": "text/plain" } })).contentType).toBe("text/plain");
  expect((await extractBufferFromFeishuResponse({ data: Readable.from([Buffer.from("d")]) })).buffer.toString()).toBe("d");
});

test("downloadFeishuMessageResource calls messageResource.get and extracts filename", async () => {
  const calls: unknown[] = [];
  const client = {
    im: {
      messageResource: {
        get: async (input: unknown) => {
          calls.push(input);
          return {
            data: Buffer.from("pdf"),
            headers: {
              "content-type": "application/pdf",
              "content-disposition": "attachment; filename*=UTF-8''report.pdf",
            },
          };
        },
      },
    },
  };

  const result = await downloadFeishuMessageResource({
    client,
    messageId: "om_1",
    fileKey: "file_1",
    resourceType: "file",
  });

  expect(calls[0]).toEqual({ path: { message_id: "om_1", file_key: "file_1" }, params: { type: "file" } });
  expect(result.buffer.toString()).toBe("pdf");
  expect(result.contentType).toBe("application/pdf");
  expect(result.fileName).toBe("report.pdf");
});

test("inferFeishuFileType maps common outbound extensions", () => {
  expect(inferFeishuFileType("voice.opus")).toBe("opus");
  expect(inferFeishuFileType("clip.mp4")).toBe("mp4");
  expect(inferFeishuFileType("report.pdf")).toBe("pdf");
  expect(inferFeishuFileType("archive.zip")).toBe("stream");
});

test("extractBufferFromFeishuResponse rejects oversized buffers with maxBytes", async () => {
  await expect(
    extractBufferFromFeishuResponse(Buffer.alloc(100), 50),
  ).rejects.toThrow("exceeds 50 bytes");
});

test("extractBufferFromFeishuResponse rejects oversized streams with maxBytes", async () => {
  const stream = Readable.from([Buffer.alloc(100)]);
  await expect(
    extractBufferFromFeishuResponse(stream, 50),
  ).rejects.toThrow("exceeds 50 bytes");
});

test("downloadFeishuMessageResource uses resourceType='file' for non-image resources", async () => {
  const calls: unknown[] = [];
  const client = {
    im: {
      messageResource: {
        get: async (input: unknown) => {
          calls.push(input);
          return Buffer.from("data");
        },
      },
    },
  };

  await downloadFeishuMessageResource({ client, messageId: "om_1", fileKey: "fk_audio", resourceType: "file" });
  await downloadFeishuMessageResource({ client, messageId: "om_1", fileKey: "fk_video", resourceType: "file" });

  expect(calls).toHaveLength(2);
  for (const call of calls) {
    expect((call as { params: { type: string } }).params.type).toBe("file");
  }
});

test("downloadFeishuMessageResource forwards maxBytes to extraction", async () => {
  const client = {
    im: {
      messageResource: {
        get: async () => Buffer.alloc(200),
      },
    },
  };

  await expect(
    downloadFeishuMessageResource({
      client,
      messageId: "om_1",
      fileKey: "f_1",
      resourceType: "file",
      maxBytes: 100,
    }),
  ).rejects.toThrow("exceeds 100 bytes");
});
