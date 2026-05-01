import { afterEach, expect, test } from "bun:test";

import { downloadPlainCdnBuffer } from "../../../src/weixin/cdn/pic-decrypt";

const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
});

test("downloadPlainCdnBuffer rejects CDN responses over the declared size cap", async () => {
  let cancelled = false;
  const stream = new ReadableStream<Uint8Array>({
    cancel() {
      cancelled = true;
    },
  });
  globalThis.fetch = async () =>
    new Response(stream, {
      headers: {
        "content-length": "11",
      },
    });

  await expect(
    downloadPlainCdnBuffer("", "https://cdn.example.com", "inbound image", "https://cdn.example.com/image", 10),
  ).rejects.toThrow("inbound image: CDN download exceeds 10 bytes");
  expect(cancelled).toBe(true);
});

test("downloadPlainCdnBuffer counts streamed bytes when content-length is absent", async () => {
  globalThis.fetch = async () => new Response(Buffer.alloc(11));

  await expect(
    downloadPlainCdnBuffer("", "https://cdn.example.com", "inbound image", "https://cdn.example.com/image", 10),
  ).rejects.toThrow("inbound image: CDN download exceeds 10 bytes");
});

test("downloadPlainCdnBuffer cancels the response reader after streamed bytes exceed the cap", async () => {
  let cancelled = false;
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(new Uint8Array(11));
    },
    cancel() {
      cancelled = true;
    },
  });
  globalThis.fetch = async () => new Response(stream);

  await expect(
    downloadPlainCdnBuffer("", "https://cdn.example.com", "inbound image", "https://cdn.example.com/image", 10),
  ).rejects.toThrow("inbound image: CDN download exceeds 10 bytes");
  expect(cancelled).toBe(true);
});
