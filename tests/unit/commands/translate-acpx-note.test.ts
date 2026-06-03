import { beforeEach, expect, test } from "bun:test";

import { translateAcpxNote } from "../../../src/commands/translate-acpx-note";
import { setLocale, t } from "../../../src/i18n";

beforeEach(() => {
  setLocale("zh");
});

test("translates built-in agent spawn line", () => {
  expect(
    translateAcpxNote("[acpx] spawning installed built-in agent opencode@0.1.2 via npx opencode"),
  ).toBe(t().acpxNote.spawnBuiltIn("opencode"));
});

test("translates generic agent spawn line", () => {
  expect(translateAcpxNote("[acpx] spawning agent: npx codex-acp")).toBe(
    t().acpxNote.spawnAgent,
  );
});

test("translates npm download lines", () => {
  expect(translateAcpxNote("npm http fetch GET 200 https://registry.npmjs.org/opencode")).toBe(
    t().acpxNote.downloading,
  );
});

test("translates extraction lines", () => {
  expect(translateAcpxNote("extracting opencode-0.1.2.tgz")).toBe(t().acpxNote.installing);
});

test("falls back to truncated raw line for unknown patterns", () => {
  const out = translateAcpxNote("something the user probably cares about");
  expect(out).toBe(t().acpxNote.fallback("something the user probably cares about"));
});

test("truncates overly long fallback lines", () => {
  const long = "a".repeat(200);
  const out = translateAcpxNote(long);
  expect(out).toBeDefined();
  expect(out!.length).toBeLessThanOrEqual(84);
  expect(out!.endsWith("…")).toBe(true);
});

test("returns null for blank lines", () => {
  expect(translateAcpxNote("")).toBeNull();
  expect(translateAcpxNote("[acpx] ")).toBeNull();
});

test("drops low-value npm timing/notice/info lines", () => {
  expect(translateAcpxNote("npm timing npm:load:setTitle Completed in 0ms")).toBeNull();
  expect(translateAcpxNote("npm notice Beginning October 4, 2021, ...")).toBeNull();
  expect(translateAcpxNote("npm verb cli /usr/bin/node")).toBeNull();
});

test("translates pnpm/yarn/bun install as download", () => {
  expect(translateAcpxNote("pnpm add opencode")).toBe(t().acpxNote.downloading);
  expect(translateAcpxNote("yarn install")).toBe(t().acpxNote.downloading);
  expect(translateAcpxNote("bun install --production")).toBe(t().acpxNote.downloading);
});
