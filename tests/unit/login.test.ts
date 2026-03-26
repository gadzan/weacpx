import { expect, test } from "bun:test";

import { buildWeixinSdkSourceCandidates } from "../../src/weixin-sdk";

test("builds source candidates from explicit index path", () => {
  expect(
    buildWeixinSdkSourceCandidates("/tmp/sdk/index.ts", "file:///repo/src/weixin-sdk.ts"),
  ).toEqual(["/tmp/sdk/index.ts"]);
});

test("builds repository fallback source candidate", () => {
  expect(buildWeixinSdkSourceCandidates(undefined, "file:///repo/src/weixin-sdk.ts")).toEqual([]);
});
