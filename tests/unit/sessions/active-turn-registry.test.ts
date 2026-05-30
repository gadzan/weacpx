import { expect, test } from "bun:test";
import { createActiveTurnRegistry } from "../../../src/sessions/active-turn-registry";

test("marks a session active then inactive", () => {
  const reg = createActiveTurnRegistry();
  const chatKey = "weixin:a:u";
  expect(reg.isActive(chatKey, "backend")).toBe(false);
  reg.markActive(chatKey, "backend");
  expect(reg.isActive(chatKey, "backend")).toBe(true);
  reg.markInactive(chatKey, "backend");
  expect(reg.isActive(chatKey, "backend")).toBe(false);
});

test("tracks two sessions in the same chat independently", () => {
  const reg = createActiveTurnRegistry();
  const chatKey = "weixin:a:u";
  reg.markActive(chatKey, "a");
  reg.markActive(chatKey, "b");
  reg.markInactive(chatKey, "a");
  expect(reg.isActive(chatKey, "a")).toBe(false);
  expect(reg.isActive(chatKey, "b")).toBe(true);
});
