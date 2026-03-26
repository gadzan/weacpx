import { expect, test } from "bun:test";

import { buildWeixinSdkImportCandidates } from "../../src/weixin-sdk";

test("prefers explicit sdk path from environment", () => {
  const candidates = buildWeixinSdkImportCandidates(
    "/custom/weixin-agent-sdk/index.ts",
    "file:///repo/src/weixin-sdk.ts",
  );

  expect(candidates[0]).toBe("/custom/weixin-agent-sdk/index.ts");
  expect(candidates).toContain("weixin-agent-sdk");
});

test("includes repository fallback next to the project root", () => {
  const candidates = buildWeixinSdkImportCandidates(undefined, "file:///repo/src/weixin-sdk.ts");

  expect(candidates[0]).toBe("weixin-agent-sdk");
  expect(candidates).toEqual(["weixin-agent-sdk"]);
});
