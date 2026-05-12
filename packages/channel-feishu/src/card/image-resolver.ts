import { Readable } from "node:stream";

import { extractBufferFromFeishuResponse } from "../media.js";

const IMAGE_RE = /!\[([^\]]*)\]\(([^)\s]+)\)/g;

export interface ImageUploadClient {
  im: {
    image?: {
      create(input: { data: { image_type: "message"; image: unknown } }): Promise<unknown>;
    };
  };
}

export interface ImageResolverOptions {
  client: ImageUploadClient;
  /** Called whenever a previously-pending upload completes successfully. */
  onImageResolved: () => void;
  /** Optional override for fetching remote image bytes. Defaults to global fetch. */
  fetchUrl?: (url: string) => Promise<Buffer>;
  /** Optional logger; receives string events for observability. */
  log?: (event: string, context?: Record<string, unknown>) => void;
  /** Max bytes per image. Defaults to 5 MiB. */
  maxBytes?: number;
}

const DEFAULT_MAX_BYTES = 5 * 1024 * 1024;

/**
 * Streams-friendly resolver that swaps `![alt](https://...)` references for
 * `![alt](img_xxx)` Feishu image keys.
 *
 * - Synchronous `resolveImages` is safe to call on every flush; it never
 *   blocks. Unknown URLs are stripped and queued for async upload.
 * - `onImageResolved` fires when a URL finishes uploading, letting the
 *   caller re-flush so the resolved image surfaces.
 * - `resolveImagesAwait` is for terminal states (complete/abort) so the
 *   final card carries all known image keys.
 */
export class ImageResolver {
  private readonly resolved = new Map<string, string>();
  private readonly pending = new Map<string, Promise<string | null>>();
  private readonly failed = new Set<string>();
  private readonly client: ImageUploadClient;
  private readonly onImageResolved: () => void;
  private readonly fetchUrl: (url: string) => Promise<Buffer>;
  private readonly log?: ImageResolverOptions["log"];
  private readonly maxBytes: number;

  constructor(options: ImageResolverOptions) {
    this.client = options.client;
    this.onImageResolved = options.onImageResolved;
    this.fetchUrl = options.fetchUrl ?? defaultFetchUrl;
    this.log = options.log;
    this.maxBytes = options.maxBytes ?? DEFAULT_MAX_BYTES;
  }

  resolveImages(text: string): string {
    if (!text.includes("![")) return text;
    return text.replace(IMAGE_RE, (fullMatch, alt: string, value: string) => {
      if (value.startsWith("img_")) return fullMatch;
      if (!value.startsWith("http://") && !value.startsWith("https://")) return "";
      const cached = this.resolved.get(value);
      if (cached) return `![${alt}](${cached})`;
      if (this.failed.has(value)) return "";
      if (this.pending.has(value)) return "";
      this.startUpload(value);
      return "";
    });
  }

  async resolveImagesAwait(text: string, timeoutMs: number): Promise<string> {
    this.resolveImages(text);
    if (this.pending.size > 0) {
      const allUploads = Promise.all(this.pending.values());
      const timeout = new Promise<void>((resolve) => setTimeout(resolve, timeoutMs));
      await Promise.race([allUploads, timeout]);
    }
    return this.resolveImages(text);
  }

  hasPending(): boolean {
    return this.pending.size > 0;
  }

  private startUpload(url: string): void {
    if (!this.client.im.image) {
      // SDK doesn't expose image upload — mark as failed so we don't retry.
      this.failed.add(url);
      return;
    }
    const p = this.doUpload(url);
    this.pending.set(url, p);
  }

  private async doUpload(url: string): Promise<string | null> {
    try {
      this.log?.("image.upload.start", { url });
      const buffer = await this.fetchUrl(url);
      if (buffer.byteLength > this.maxBytes) {
        throw new Error(`image exceeds maxBytes (${buffer.byteLength} > ${this.maxBytes})`);
      }
      const response = await this.client.im.image!.create({
        data: { image_type: "message", image: Readable.from(buffer) },
      });
      const imageKey = extractImageKey(response);
      if (!imageKey) throw new Error("image.create returned no image_key");
      this.resolved.set(url, imageKey);
      this.pending.delete(url);
      this.log?.("image.upload.done", { url, imageKey });
      this.onImageResolved();
      return imageKey;
    } catch (error) {
      this.pending.delete(url);
      this.failed.add(url);
      this.log?.("image.upload.failed", {
        url,
        message: error instanceof Error ? error.message : String(error),
      });
      return null;
    }
  }
}

function extractImageKey(response: unknown): string | undefined {
  if (!response || typeof response !== "object") return undefined;
  const rec = response as { image_key?: unknown; data?: { image_key?: unknown } };
  if (typeof rec.image_key === "string") return rec.image_key;
  if (typeof rec.data?.image_key === "string") return rec.data.image_key;
  return undefined;
}

async function defaultFetchUrl(url: string): Promise<Buffer> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`fetch ${url} → ${res.status}`);
  const ab = await res.arrayBuffer();
  return Buffer.from(ab);
}

// Re-export the buffer extractor in case callers want to use it for tests.
export { extractBufferFromFeishuResponse };
