import { expect, test } from "bun:test";

import { ImageResolver } from "../../../../packages/channel-feishu/src/card/image-resolver";

function createUploadClient(options: { failUpload?: boolean; noImageApi?: boolean } = {}) {
  const uploads: Array<{ kind: string }> = [];
  let counter = 0;
  const client = options.noImageApi
    ? { im: {} }
    : {
        im: {
          image: {
            create: async (input: { data: { image_type: string; image: unknown } }) => {
              if (options.failUpload) throw new Error("upload boom");
              uploads.push({ kind: input.data.image_type });
              counter += 1;
              return { data: { image_key: `img_${counter}` } };
            },
          },
        },
      };
  return { client, uploads };
}

test("resolveImages keeps img_xxx untouched", () => {
  const { client } = createUploadClient();
  const resolver = new ImageResolver({ client, onImageResolved: () => {} });
  expect(resolver.resolveImages("![cat](img_already_uploaded)")).toBe("![cat](img_already_uploaded)");
});

test("resolveImages strips non-HTTP refs (local paths, data URIs)", () => {
  const { client } = createUploadClient();
  const resolver = new ImageResolver({ client, onImageResolved: () => {} });
  const out = resolver.resolveImages("a ![](./local.png) b ![](data:image/png;base64,xxx) c");
  expect(out).toBe("a  b  c");
});

test("first encounter of a remote URL strips it and starts upload; later calls return resolved key", async () => {
  const { client } = createUploadClient();
  let notified = 0;
  const resolver = new ImageResolver({
    client,
    onImageResolved: () => {
      notified += 1;
    },
    fetchUrl: async () => Buffer.from([1, 2, 3]),
  });

  const firstPass = resolver.resolveImages("hi ![alt](https://example.com/a.png) bye");
  expect(firstPass).toBe("hi  bye");

  await new Promise((r) => setTimeout(r, 10));
  expect(notified).toBe(1);

  const secondPass = resolver.resolveImages("hi ![alt](https://example.com/a.png) bye");
  expect(secondPass).toBe("hi ![alt](img_1) bye");
});

test("resolveImagesAwait waits for all uploads then returns resolved text", async () => {
  const { client } = createUploadClient();
  const resolver = new ImageResolver({
    client,
    onImageResolved: () => {},
    fetchUrl: async () => Buffer.from([1, 2]),
  });
  const resolved = await resolver.resolveImagesAwait(
    "![a](https://example.com/1.png) ![b](https://example.com/2.png)",
    1000,
  );
  expect(resolved).toMatch(/!\[a\]\(img_[12]\) !\[b\]\(img_[12]\)/);
});

test("failed uploads are not retried", async () => {
  const { client, uploads } = createUploadClient({ failUpload: true });
  const resolver = new ImageResolver({
    client,
    onImageResolved: () => {},
    fetchUrl: async () => Buffer.from([1]),
  });

  resolver.resolveImages("![x](https://example.com/x.png)");
  await new Promise((r) => setTimeout(r, 10));
  resolver.resolveImages("![x](https://example.com/x.png)");
  await new Promise((r) => setTimeout(r, 10));
  expect(uploads).toHaveLength(0); // upload threw, no entries recorded
});

test("when SDK lacks im.image, URLs are stripped without upload attempt", () => {
  const { client } = createUploadClient({ noImageApi: true });
  const resolver = new ImageResolver({ client, onImageResolved: () => {} });
  const out = resolver.resolveImages("![x](https://example.com/x.png)");
  expect(out).toBe("");
  expect(resolver.hasPending()).toBe(false);
});

test("oversized image is rejected", async () => {
  const { client, uploads } = createUploadClient();
  const resolver = new ImageResolver({
    client,
    onImageResolved: () => {},
    fetchUrl: async () => Buffer.alloc(10),
    maxBytes: 5,
  });
  resolver.resolveImages("![x](https://example.com/x.png)");
  await new Promise((r) => setTimeout(r, 10));
  expect(uploads).toHaveLength(0);
});
