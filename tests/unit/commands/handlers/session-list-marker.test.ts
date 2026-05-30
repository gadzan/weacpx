import { expect, test } from "bun:test";
import { decorateUnread } from "../../../../src/commands/handlers/session-list-marker";

test("prefixes a dot when unread", () => {
  expect(decorateUnread("backend", true)).toBe("● backend");
});
test("leaves label unchanged when not unread", () => {
  expect(decorateUnread("backend", false)).toBe("backend");
});
