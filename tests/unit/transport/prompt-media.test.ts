import { expect, test } from "bun:test";
import { mkdtemp, readFile, rm, truncate, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { createStructuredPromptFile } from "../../../src/transport/prompt-media";

const imageMedia = (filePath: string) => ({
  type: "image" as const,
  filePath,
  mimeType: "image/*",
});

test("createStructuredPromptFile rejects non-regular image paths", async () => {
  const dir = await mkdtemp(join(tmpdir(), "weacpx-prompt-media-dir-"));
  try {
    await expect(createStructuredPromptFile("", imageMedia(dir))).rejects.toThrow(
      "image prompt path must be a regular file",
    );
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("createStructuredPromptFile rejects empty image files", async () => {
  const dir = await mkdtemp(join(tmpdir(), "weacpx-prompt-media-empty-"));
  const filePath = join(dir, "empty.png");
  await writeFile(filePath, "");
  try {
    await expect(createStructuredPromptFile("", imageMedia(filePath))).rejects.toThrow(
      "image prompt must not be empty",
    );
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("createStructuredPromptFile rejects image files over the size cap before creating temp prompt files", async () => {
  const dir = await mkdtemp(join(tmpdir(), "weacpx-prompt-media-large-"));
  const filePath = join(dir, "large.png");
  await writeFile(filePath, "");
  await truncate(filePath, 100 * 1024 * 1024 + 1);
  try {
    await expect(createStructuredPromptFile("", imageMedia(filePath))).rejects.toThrow(
      "image prompt exceeds 104857600 bytes",
    );
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("createStructuredPromptFile rejects when actual bytes read exceed the size cap", async () => {
  const oversized = Buffer.alloc(100 * 1024 * 1024 + 1);
  await expect(
    createStructuredPromptFile("", imageMedia("/tmp/race.png"), {
      readImageFile: async () => oversized,
      mkdtemp: async () => {
        throw new Error("mkdtemp should not be called");
      },
      writeFile: async () => {},
      rm: async () => {},
      tmpdir: () => tmpdir(),
    }),
  ).rejects.toThrow("image prompt exceeds 104857600 bytes");
});

test("createStructuredPromptFile removes temp directory when prompt json write fails", async () => {
  const removed: Array<{ path: string; recursive?: boolean; force?: boolean }> = [];

  await expect(
    createStructuredPromptFile("caption", imageMedia("/tmp/image.png"), {
      readImageFile: async () => Buffer.from("89504e470d0a1a0a", "hex"),
      mkdtemp: async () => "/tmp/weacpx-acp-prompt-test",
      writeFile: async () => {
        throw new Error("disk full");
      },
      rm: async (path, options) => {
        removed.push({ path, ...options });
      },
      tmpdir: () => "/tmp",
    }),
  ).rejects.toThrow("disk full");

  expect(removed).toEqual([
    { path: "/tmp/weacpx-acp-prompt-test", recursive: true, force: true },
  ]);
});

test("createStructuredPromptFile preserves write failure when cleanup also fails", async () => {
  await expect(
    createStructuredPromptFile("caption", imageMedia("/tmp/image.png"), {
      readImageFile: async () => Buffer.from("89504e470d0a1a0a", "hex"),
      mkdtemp: async () => "/tmp/weacpx-acp-prompt-test",
      writeFile: async () => {
        throw new Error("disk full");
      },
      rm: async () => {
        throw new Error("rm failed");
      },
      tmpdir: () => "/tmp",
    }),
  ).rejects.toThrow("disk full");
});

test("createStructuredPromptFile writes text and image blocks and cleanup removes the prompt file", async () => {
  const dir = await mkdtemp(join(tmpdir(), "weacpx-prompt-media-ok-"));
  const filePath = join(dir, "image.png");
  await writeFile(filePath, Buffer.from("89504e470d0a1a0a", "hex"));
  try {
    const structured = await createStructuredPromptFile("看图", imageMedia(filePath));
    expect(structured).not.toBeNull();
    const json = JSON.parse(await readFile(structured!.filePath, "utf8"));
    expect(json).toEqual([
      { type: "text", text: "看图" },
      {
        type: "image",
        mimeType: "image/png",
        data: Buffer.from("89504e470d0a1a0a", "hex").toString("base64"),
      },
    ]);
    await structured!.cleanup();
    await expect(readFile(structured!.filePath, "utf8")).rejects.toThrow();
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("createStructuredPromptFile writes multiple image blocks", async () => {
  const writes = new Map<string, string>();
  const file = await createStructuredPromptFile("look", [
    { type: "image", filePath: "/tmp/a.png", mimeType: "image/png" },
    { type: "image", filePath: "/tmp/b.jpg", mimeType: "image/jpeg", fileName: "b.jpg" },
  ], {
    readImageFile: async (filePath) =>
      filePath.endsWith("a.png")
        ? Buffer.from("89504e470d0a1a0a", "hex")
        : Buffer.from([0xff, 0xd8, 0xff, 0x00]),
    mkdtemp: async () => "/tmp/structured",
    writeFile: async (filePath, data) => {
      writes.set(filePath, data);
    },
    rm: async () => {},
    tmpdir: () => "/tmp",
  });

  expect(file?.filePath.replaceAll("\\", "/")).toBe("/tmp/structured/prompt.json");
  const blocks = JSON.parse(writes.get(file!.filePath)!) as unknown[];
  expect(blocks).toHaveLength(3);
  expect(blocks[0]).toEqual({ type: "text", text: "look" });
  expect(blocks[1]).toMatchObject({ type: "image", mimeType: "image/png" });
  expect(blocks[2]).toMatchObject({ type: "image", mimeType: "image/jpeg" });
});

test("createStructuredPromptFile converts non-images into resource blocks and summary text", async () => {
  const writes = new Map<string, string>();
  const file = await createStructuredPromptFile("summarize", [
    {
      type: "file",
      filePath: "/Users/me/report.pdf",
      mimeType: "application/pdf",
      fileName: "report.pdf",
    },
    {
      type: "audio",
      filePath: "/Users/me/voice.opus",
      mimeType: "audio/opus",
      fileName: "voice.opus",
    },
  ], {
    readImageFile: async () => Buffer.alloc(0),
    mkdtemp: async () => "/tmp/structured",
    writeFile: async (filePath, data) => {
      writes.set(filePath, data);
    },
    rm: async () => {},
    tmpdir: () => "/tmp",
  });

  expect(file?.filePath.replaceAll("\\", "/")).toBe("/tmp/structured/prompt.json");
  const blocks = JSON.parse(writes.get(file!.filePath)!) as Array<Record<string, unknown>>;
  expect(blocks[0]).toMatchObject({ type: "text", text: "summarize" });
  expect(String((blocks[1] as { text: string }).text)).toContain("Attachments available as local files");
  expect(blocks[2]).toMatchObject({
    type: "resource",
    resource: { uri: "file:///Users/me/report.pdf" },
  });
  expect(blocks[3]).toMatchObject({
    type: "resource",
    resource: { uri: "file:///Users/me/voice.opus" },
  });
});
