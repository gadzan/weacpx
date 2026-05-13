/**
 * Stream-aware downloader for inbound TIM media URLs.
 *
 * Used by the channel to fetch images / files into the runtime media store
 * before passing them as `ChannelMediaAttachment[]` to `agent.chat`.
 *
 * The streamer caps the read at `maxBytes` so a server-side oversize
 * response can't blow up the daemon's memory.
 */

const DEFAULT_TIMEOUT_MS = 30_000;

export interface DownloadedInboundMedia {
  buffer: Buffer;
  contentType: string;
}

export interface DownloadInboundMediaOptions {
  url: string;
  maxBytes: number;
  /** Per-request hard timeout. Default 30s. */
  timeoutMs?: number;
  /** Injectable fetch for tests. */
  fetch?: typeof fetch;
  /** Caller's abort signal — typically the daemon shutdown signal. */
  signal?: AbortSignal;
}

export async function downloadInboundYuanbaoMedia(opts: DownloadInboundMediaOptions): Promise<DownloadedInboundMedia> {
  const f = opts.fetch ?? fetch;
  const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;

  const controller = new AbortController();
  const onParentAbort = (): void => { controller.abort(); };
  if (opts.signal) {
    if (opts.signal.aborted) controller.abort();
    else opts.signal.addEventListener("abort", onParentAbort, { once: true });
  }
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const res = await f(opts.url, { signal: controller.signal });
    if (!res.ok) {
      throw new Error(`media fetch failed: HTTP ${res.status}`);
    }
    const declaredLength = Number(res.headers.get("content-length") ?? "");
    if (Number.isFinite(declaredLength) && declaredLength > opts.maxBytes) {
      throw new Error(`media exceeds maxBytes (content-length=${declaredLength} > ${opts.maxBytes})`);
    }
    const contentType = res.headers.get("content-type")?.split(";")[0]?.trim() || "application/octet-stream";

    const body = res.body as ReadableStream<Uint8Array> | null;
    if (!body) {
      const arrayBuf = await res.arrayBuffer();
      if (arrayBuf.byteLength > opts.maxBytes) {
        throw new Error(`media exceeds maxBytes (body=${arrayBuf.byteLength} > ${opts.maxBytes})`);
      }
      return { buffer: Buffer.from(arrayBuf), contentType };
    }

    const reader = body.getReader();
    const chunks: Uint8Array[] = [];
    let total = 0;
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!value) continue;
      total += value.byteLength;
      if (total > opts.maxBytes) {
        await reader.cancel().catch(() => {});
        throw new Error(`media exceeds maxBytes (streamed > ${opts.maxBytes})`);
      }
      chunks.push(value);
    }
    return { buffer: Buffer.concat(chunks.map((c) => Buffer.from(c))), contentType };
  } finally {
    clearTimeout(timer);
    if (opts.signal) opts.signal.removeEventListener("abort", onParentAbort);
  }
}

const MIME_EXT_FALLBACK: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/gif": "gif",
  "image/webp": "webp",
};

/** Pick a stable filename for a downloaded image when the IM payload didn't provide one. */
export function defaultImageFileName(contentType: string, urlPath: string): string {
  const url = safeUrlBasename(urlPath);
  if (url) return url;
  const ext = MIME_EXT_FALLBACK[contentType.toLowerCase()] ?? "bin";
  return `image.${ext}`;
}

function safeUrlBasename(url: string): string | undefined {
  try {
    const u = new URL(url);
    const name = u.pathname.split("/").filter(Boolean).at(-1);
    if (name && /\.[A-Za-z0-9]{1,8}$/.test(name)) return name;
    return undefined;
  } catch {
    return undefined;
  }
}
