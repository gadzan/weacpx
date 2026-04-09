import { expect, test } from "bun:test";

test("weixin api module loads and can build base info", async () => {
  const { buildBaseInfo } = await import("../../../src/weixin/api/api");
  expect(buildBaseInfo()).toEqual({ channel_version: expect.any(String) });
});
