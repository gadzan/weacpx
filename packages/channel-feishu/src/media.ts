import fs from "node:fs";
import path from "node:path";
import { Readable } from "node:stream";

export type FeishuResourceApiType = "image" | "file";
export type FeishuFileType = "opus" | "mp4" | "pdf" | "doc" | "xls" | "ppt" | "stream";

export interface FeishuMediaClient {
  im: {
    messageResource: {
      get(input: { path: { message_id: string; file_key: string }; params: { type: FeishuResourceApiType } }): Promise<unknown>;
    };
    image?: { create(input: { data: { image_type: "message"; image: unknown } }): Promise<unknown> };
    file?: { create(input: { data: { file_type: FeishuFileType; file_name: string; file: unknown; duration?: string } }): Promise<unknown> };
    message?: {
      reply(input: { path: { message_id: string }; data: { msg_type: "image" | "file" | "audio" | "media"; content: string; reply_in_thread?: boolean } }): Promise<{ data?: { message_id?: string; chat_id?: string } }>;
      create(input: { params: { receive_id_type: "chat_id" | "open_id" | "user_id" }; data: { receive_id: string; msg_type: "image" | "file" | "audio" | "media"; content: string } }): Promise<{ data?: { message_id?: string; chat_id?: string } }>;
    };
  };
}

export async function extractBufferFromFeishuResponse(response: unknown, maxBytes?: number): Promise<{ buffer: Buffer; contentType?: string; fileName?: string }> {
  if (Buffer.isBuffer(response)) {
    checkSize(response.byteLength, maxBytes);
    return { buffer: response };
  }
  if (response instanceof ArrayBuffer) {
    checkSize(response.byteLength, maxBytes);
    return { buffer: Buffer.from(response) };
  }
  if (!response) throw new Error("empty Feishu media response");
  const record = response as Record<string, unknown>;
  const headers = (record.headers ?? {}) as Record<string, string>;
  const contentType = headers["content-type"] ?? headers["Content-Type"] ?? (typeof record.contentType === "string" ? record.contentType : undefined);
  const fileName = filenameFromDisposition(headers["content-disposition"] ?? headers["Content-Disposition"]);

  const data = record.data;
  if (Buffer.isBuffer(data)) { checkSize(data.byteLength, maxBytes); return { buffer: data, contentType, fileName }; }
  if (data instanceof ArrayBuffer) { checkSize(data.byteLength, maxBytes); return { buffer: Buffer.from(data), contentType, fileName }; }
  if (isReadable(data)) return { buffer: await streamToBuffer(data, maxBytes), contentType, fileName };
  if (typeof (record as { getReadableStream?: unknown }).getReadableStream === "function") {
    return { buffer: await streamToBuffer(await (record as { getReadableStream: () => Promise<Readable> }).getReadableStream(), maxBytes), contentType, fileName };
  }
  if (isReadable(record)) return { buffer: await streamToBuffer(record, maxBytes), contentType, fileName };
  if (isAsyncIterable(record)) {
    const chunks: Buffer[] = [];
    let totalBytes = 0;
    for await (const chunk of record as AsyncIterable<Uint8Array>) {
      const buf = Buffer.from(chunk);
      totalBytes += buf.byteLength;
      checkSize(totalBytes, maxBytes);
      chunks.push(buf);
    }
    return { buffer: Buffer.concat(chunks), contentType, fileName };
  }
  throw new Error("unable to extract Feishu media response buffer");
}

export async function downloadFeishuMessageResource(input: {
  client: FeishuMediaClient;
  messageId: string;
  fileKey: string;
  resourceType: FeishuResourceApiType;
  maxBytes?: number;
}): Promise<{ buffer: Buffer; contentType?: string; fileName?: string }> {
  const response = await input.client.im.messageResource.get({
    path: { message_id: input.messageId, file_key: input.fileKey },
    params: { type: input.resourceType },
  });
  return await extractBufferFromFeishuResponse(response, input.maxBytes);
}

export function inferFeishuFileType(fileName: string): FeishuFileType {
  const ext = path.extname(fileName).toLowerCase();
  if ([".opus", ".ogg"].includes(ext)) return "opus";
  if ([".mp4", ".mov", ".avi", ".mkv", ".webm"].includes(ext)) return "mp4";
  if (ext === ".pdf") return "pdf";
  if ([".doc", ".docx"].includes(ext)) return "doc";
  if ([".xls", ".xlsx", ".csv"].includes(ext)) return "xls";
  if ([".ppt", ".pptx"].includes(ext)) return "ppt";
  return "stream";
}

function checkSize(byteLength: number, maxBytes: number | undefined): void {
  if (maxBytes !== undefined && byteLength > maxBytes) {
    throw new Error(`Feishu media download exceeds ${maxBytes} bytes`);
  }
}

function filenameFromDisposition(value?: string): string | undefined {
  if (!value) return undefined;
  const match = value.match(/filename\*?=(?:UTF-8'')?["']?([^"';\n]+)/i);
  return match?.[1] ? decodeURIComponent(match[1].trim()) : undefined;
}

function isReadable(value: unknown): value is Readable {
  return Boolean(value && typeof (value as { pipe?: unknown }).pipe === "function");
}

function isAsyncIterable(value: unknown): value is AsyncIterable<Uint8Array> {
  return Boolean(value && typeof (value as { [Symbol.asyncIterator]: unknown })[Symbol.asyncIterator] === "function");
}

function streamToBuffer(stream: Readable, maxBytes?: number): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    let settled = false;
    const chunks: Buffer[] = [];
    let totalBytes = 0;
    stream.on("data", (chunk) => {
      if (settled) return;
      const buf = Buffer.from(chunk);
      totalBytes += buf.byteLength;
      if (maxBytes !== undefined && totalBytes > maxBytes) {
        settled = true;
        const error = new Error(`Feishu media download exceeds ${maxBytes} bytes`);
        stream.destroy(error);
        reject(error);
        return;
      }
      chunks.push(buf);
    });
    stream.on("end", () => {
      if (settled) return;
      settled = true;
      resolve(Buffer.concat(chunks));
    });
    stream.on("error", (error) => {
      if (settled) return;
      settled = true;
      reject(error);
    });
  });
}

export function createReadStreamForFeishu(filePath: string): fs.ReadStream {
  return fs.createReadStream(filePath);
}
