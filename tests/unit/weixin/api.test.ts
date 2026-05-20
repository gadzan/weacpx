import { expect, test } from "bun:test";

test("weixin api module loads and can build base info", async () => {
  const { buildBaseInfo } = await import("../../../src/weixin/api/api");
  const info = buildBaseInfo();
  expect(typeof info.channel_version).toBe("string");
  expect(typeof info.bot_agent).toBe("string");
});
