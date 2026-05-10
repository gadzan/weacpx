import { expect, test } from "bun:test";

import { getUsageText } from "../../src/cli";

test("usage shows canonical plugin lifecycle commands", () => {
  const usage = getUsageText();

  expect(usage).toContain("weacpx plugin list|add|update|remove|enable|disable|doctor|known - 管理插件");
});
