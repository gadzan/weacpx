import { mkdtemp, open, rm, writeFile } from "node:fs/promises";
import { tmpdir as defaultTmpdir } from "node:os";
import path from "node:path";

import type { PromptMedia } from "./types";

type AcpContentBlock =
  | { type: "text"; text: string }
  | { type: "image"; mimeType: string; data: string };

const MAX_STRUCTURED_IMAGE_BYTES = 100 * 1024 * 1024;

export interface StructuredPromptFile {
  filePath: string;
  cleanup: () => Promise<void>;
}

export interface StructuredPromptFileDeps {
  readImageFile: (filePath: string, maxBytes: number) => Promise<Buffer>;
  mkdtemp: (prefix: string) => Promise<string>;
  writeFile: (filePath: string, data: string, encoding: BufferEncoding) => Promise<void>;
  rm: (filePath: string, options: { recursive: true; force: true }) => Promise<void>;
  tmpdir: () => string;
}

export async function createStructuredPromptFile(
  text: string,
  media?: PromptMedia,
  deps: StructuredPromptFileDeps = defaultStructuredPromptFileDeps,
): Promise<StructuredPromptFile | null> {
  if (!media) {
    return null;
  }
  if (media.type !== "image") {
    throw new Error("prompt media type is not supported; only image media is supported");
  }

  const imageData = await deps.readImageFile(media.filePath, MAX_STRUCTURED_IMAGE_BYTES);
  if (imageData.byteLength === 0) {
    throw new Error("image prompt must not be empty");
  }
  if (imageData.byteLength > MAX_STRUCTURED_IMAGE_BYTES) {
    throw new Error(`image prompt exceeds ${MAX_STRUCTURED_IMAGE_BYTES} bytes`);
  }
  const blocks: AcpContentBlock[] = [];
  if (text.trim().length > 0) {
    blocks.push({ type: "text", text });
  }
  blocks.push({
    type: "image",
    mimeType: resolveImageMimeType(imageData, media.mimeType),
    data: imageData.toString("base64"),
  });

  let dir = "";
  try {
    dir = await deps.mkdtemp(path.join(deps.tmpdir(), "weacpx-acp-prompt-"));
    const filePath = path.join(dir, "prompt.json");
    await deps.writeFile(filePath, JSON.stringify(blocks), "utf8");
    return {
      filePath,
      cleanup: async () => {
        await deps.rm(dir, { recursive: true, force: true });
      },
    };
  } catch (error) {
    if (dir) {
      try {
        await deps.rm(dir, { recursive: true, force: true });
      } catch {
        // Preserve the original create/write failure.
      }
    }
    throw error;
  }
}

const defaultStructuredPromptFileDeps: StructuredPromptFileDeps = {
  readImageFile: readImageFileBounded,
  mkdtemp,
  writeFile,
  rm,
  tmpdir: defaultTmpdir,
};

async function readImageFileBounded(filePath: string, maxBytes: number): Promise<Buffer> {
  const handle = await open(filePath, "r");
  try {
    const imageStats = await handle.stat();
    if (!imageStats.isFile()) {
      throw new Error("image prompt path must be a regular file");
    }
    if (imageStats.size > maxBytes) {
      throw new Error(`image prompt exceeds ${maxBytes} bytes`);
    }

    const chunks: Buffer[] = [];
    let total = 0;
    let position = 0;
    const chunkSize = 1024 * 1024;
    while (total <= maxBytes) {
      const buffer = Buffer.allocUnsafe(Math.min(chunkSize, maxBytes + 1 - total));
      const { bytesRead } = await handle.read(buffer, 0, buffer.length, position);
      if (bytesRead === 0) break;
      chunks.push(buffer.subarray(0, bytesRead));
      total += bytesRead;
      position += bytesRead;
    }
    return Buffer.concat(chunks, total);
  } finally {
    await handle.close();
  }
}

function resolveImageMimeType(buffer: Buffer, declaredMimeType: string): string {
  if (/^image\/[A-Za-z0-9.+-]+$/.test(declaredMimeType) && declaredMimeType !== "image/*") {
    return declaredMimeType;
  }

  if (buffer.subarray(0, 8).equals(Buffer.from("89504e470d0a1a0a", "hex"))) {
    return "image/png";
  }
  if (buffer.length >= 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) {
    return "image/jpeg";
  }
  const header6 = buffer.subarray(0, 6).toString("ascii");
  if (header6 === "GIF87a" || header6 === "GIF89a") {
    return "image/gif";
  }
  if (
    buffer.length >= 12 &&
    buffer.subarray(0, 4).toString("ascii") === "RIFF" &&
    buffer.subarray(8, 12).toString("ascii") === "WEBP"
  ) {
    return "image/webp";
  }
  if (buffer.length >= 2 && buffer.subarray(0, 2).toString("ascii") === "BM") {
    return "image/bmp";
  }

  return "image/png";
}
