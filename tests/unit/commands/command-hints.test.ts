import { expect, test } from "bun:test";

import { listXacpxCommandHints } from "../../../src/commands/command-hints";
import { listHelpTopics } from "../../../src/commands/help/help-registry";

test("command hints: every name starts with slash and is unique", () => {
  const hints = listXacpxCommandHints();
  expect(hints.length).toBeGreaterThan(0);
  const names = hints.map((h) => h.name);
  for (const name of names) {
    expect(name.startsWith("/")).toBe(true);
  }
  expect(new Set(names).size).toBe(names.length);
});

test("command hints: descriptions are non-empty", () => {
  for (const hint of listXacpxCommandHints()) {
    expect(hint.description.trim().length).toBeGreaterThan(0);
  }
});

test("command hints: covers help topics plus /help", () => {
  const names = new Set(listXacpxCommandHints().map((h) => h.name));
  // 新增 help topic 若未在导出器登记，listXacpxCommandHints 会抛错（见实现）。
  expect(listHelpTopics().length).toBeGreaterThan(0);
  expect(names.has("/help")).toBe(true);
  expect(names.has("/session")).toBe(true);
  expect(names.has("/ssn")).toBe(true);
});
