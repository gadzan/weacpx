import { mkdtemp, readFile, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { test, expect } from "bun:test";

import {
  DEFAULT_MEDIA_RETENTION_MS,
  RuntimeMediaStore,
  sanitizeMediaFileName,
} from "../../../src/channels/media-store";

test("sanitizeMediaFileName removes traversal and unsafe characters", () => {
  expect(sanitizeMediaFileName("../../evil name?.png", "image/png")).toBe("evil-name-.png");
  expect(sanitizeMediaFileName("", "application/pdf")).toMatch(/^attachment\.pdf$/);
  expect(sanitizeMediaFileName("no-ext", "image/jpeg")).toBe("no-ext.jpg");
});

test("saveMediaBuffer stores media under channel/chat/message directory", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "weacpx-media-store-"));
  const store = new RuntimeMediaStore({ rootDir: root });

  const saved = await store.saveMediaBuffer({
    channelId: "feishu",
    accountId: "default",
    chatKey: "feishu:default:oc_123:thread:omt_1",
    messageId: "om_1",
    fileName: "report.pdf",
    mimeType: "application/pdf",
    kind: "file",
    buffer: Buffer.from("hello"),
    sourceResourceId: "file_x",
    maxBytes: 10,
  });

  expect(saved.kind).toBe("file");
  expect(saved.mimeType).toBe("application/pdf");
  expect(saved.fileName).toBe("report.pdf");
  expect(saved.sizeBytes).toBe(5);
  expect(saved.source).toEqual({
    channelId: "feishu",
    accountId: "default",
    chatKey: "feishu:default:oc_123:thread:omt_1",
    messageId: "om_1",
    resourceId: "file_x",
  });
  expect(saved.filePath.startsWith(root + path.sep)).toBe(true);
  expect(await readFile(saved.filePath, "utf8")).toBe("hello");
});

test("saveMediaBuffer rejects oversized buffers before writing", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "weacpx-media-store-"));
  const store = new RuntimeMediaStore({ rootDir: root });

  await expect(
    store.saveMediaBuffer({
      channelId: "weixin",
      accountId: "default",
      chatKey: "weixin:default:wxid_1",
      messageId: "msg_1",
      mimeType: "image/png",
      kind: "image",
      buffer: Buffer.alloc(11),
      maxBytes: 10,
    }),
  ).rejects.toThrow("media exceeds 10 bytes");
});

test("saveMediaBuffer generates unique filenames when multiple nameless attachments share a message", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "weacpx-media-store-"));
  const store = new RuntimeMediaStore({ rootDir: root });

  const input = {
    channelId: "weixin" as const,
    accountId: "default",
    chatKey: "weixin:default:wxid_1",
    messageId: "msg_1",
    mimeType: "image/png",
    kind: "image" as const,
    maxBytes: 100,
  };

  const saved1 = await store.saveMediaBuffer({ ...input, buffer: Buffer.from("img1") });
  const saved2 = await store.saveMediaBuffer({ ...input, buffer: Buffer.from("img2") });
  const saved3 = await store.saveMediaBuffer({ ...input, buffer: Buffer.from("img3") });

  expect(saved1.fileName).toBe("attachment.png");
  expect(saved2.fileName).toBe("attachment-2.png");
  expect(saved3.fileName).toBe("attachment-3.png");
  expect(saved1.filePath).not.toBe(saved2.filePath);
  expect(saved2.filePath).not.toBe(saved3.filePath);
  expect(await readFile(saved1.filePath, "utf8")).toBe("img1");
  expect(await readFile(saved2.filePath, "utf8")).toBe("img2");
  expect(await readFile(saved3.filePath, "utf8")).toBe("img3");
});

test("cleanupExpired removes old media files and keeps fresh files", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "weacpx-media-store-"));
  const store = new RuntimeMediaStore({ rootDir: root, retentionMs: DEFAULT_MEDIA_RETENTION_MS });

  const oldFile = path.join(root, "weixin", "chat", "old", "a.txt");
  const freshFile = path.join(root, "weixin", "chat", "fresh", "b.txt");
  await import("node:fs/promises").then((fs) => fs.mkdir(path.dirname(oldFile), { recursive: true }));
  await writeFile(oldFile, "old");
  await import("node:fs/promises").then((fs) => fs.mkdir(path.dirname(freshFile), { recursive: true }));
  await writeFile(freshFile, "fresh");

  const oldDate = new Date(Date.now() - DEFAULT_MEDIA_RETENTION_MS - 60_000);
  await import("node:fs/promises").then((fs) => fs.utimes(oldFile, oldDate, oldDate));

  await store.cleanupExpired(new Date());

  await expect(stat(oldFile)).rejects.toThrow();
  expect((await readFile(freshFile, "utf8"))).toBe("fresh");
});
