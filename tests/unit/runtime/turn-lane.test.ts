import { expect, test } from "bun:test";
import { resolveTurnLane } from "../../../src/runtime/turn-lane";

test("/ss switch goes to control lane", () => {
  expect(resolveTurnLane("/ss backend")).toBe("control");
});

test("/use switch goes to control lane", () => {
  expect(resolveTurnLane("/use backend")).toBe("control");
});

test("/cancel goes to control lane", () => {
  expect(resolveTurnLane("/cancel")).toBe("control");
});

test("/stop goes to control lane", () => {
  expect(resolveTurnLane("/stop backend")).toBe("control");
});

test("/ssn (native session list) stays normal — it can be slow", () => {
  expect(resolveTurnLane("/ssn codex")).toBe("normal");
});

test("a plain prompt stays normal", () => {
  expect(resolveTurnLane("帮我重构这个函数")).toBe("normal");
});

test("leading whitespace is tolerated", () => {
  expect(resolveTurnLane("  /ss backend")).toBe("control");
});
