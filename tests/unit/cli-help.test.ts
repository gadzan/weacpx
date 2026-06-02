import { beforeEach, expect, test } from "bun:test";

import { getUsageText } from "../../src/cli";
import { setLocale, t } from "../../src/i18n";

beforeEach(() => {
  setLocale("zh");
});

test("usage shows canonical plugin lifecycle commands", () => {
  const usage = getUsageText();

  const pluginLine = t().cli.helpLines.find((line) => line.includes("plugin list|add"));
  expect(pluginLine).toBeDefined();
  expect(usage).toContain(pluginLine!);
});

test("usage text equals the joined help catalog", () => {
  const usage = getUsageText();

  expect(usage).toBe(t().cli.helpLines.join("\n"));
});
