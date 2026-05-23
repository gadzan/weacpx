import { expect, test } from "bun:test";

import { authorizeCommandForChat, renderCommandAccessDenied } from "../../../src/commands/command-policy";
import { parseCommand } from "../../../src/commands/parse-command";

test("command policy allows read-only commands for non-owner group members", () => {
  expect(authorizeCommandForChat(parseCommand("/help"), { chatType: "group", isOwner: false })).toEqual({ allowed: true });
  expect(authorizeCommandForChat(parseCommand("/agents"), { chatType: "group", isOwner: false })).toEqual({ allowed: true });
  expect(authorizeCommandForChat(parseCommand("/workspaces"), { chatType: "group", isOwner: false })).toEqual({ allowed: true });
  expect(authorizeCommandForChat(parseCommand("/sessions"), { chatType: "group", isOwner: false })).toEqual({ allowed: true });
  expect(authorizeCommandForChat(parseCommand("/status"), { chatType: "group", isOwner: false })).toEqual({ allowed: true });
  expect(authorizeCommandForChat(parseCommand("/mode"), { chatType: "group", isOwner: false })).toEqual({ allowed: true });
  expect(authorizeCommandForChat(parseCommand("/replymode"), { chatType: "group", isOwner: false })).toEqual({ allowed: true });
  expect(authorizeCommandForChat(parseCommand("/config"), { chatType: "group", isOwner: false })).toEqual({ allowed: true });
  expect(authorizeCommandForChat(parseCommand("/permission"), { chatType: "group", isOwner: false })).toEqual({ allowed: true });
  expect(authorizeCommandForChat(parseCommand("/permission auto"), { chatType: "group", isOwner: false })).toEqual({ allowed: true });
  expect(authorizeCommandForChat(parseCommand("/tasks"), { chatType: "group", isOwner: false })).toEqual({ allowed: true });
  expect(authorizeCommandForChat(parseCommand("/task task-1"), { chatType: "group", isOwner: false })).toEqual({ allowed: true });
  expect(authorizeCommandForChat(parseCommand("/groups"), { chatType: "group", isOwner: false })).toEqual({ allowed: true });
  expect(authorizeCommandForChat(parseCommand("/group g-1"), { chatType: "group", isOwner: false })).toEqual({ allowed: true });
});

test("command policy blocks mutating commands for non-owner group members", () => {
  expect(authorizeCommandForChat(parseCommand("/permission set deny"), { chatType: "group", isOwner: false })).toMatchObject({ allowed: false });
  expect(authorizeCommandForChat(parseCommand("/permission auto deny"), { chatType: "group", isOwner: false })).toMatchObject({ allowed: false });
  expect(authorizeCommandForChat(parseCommand("/config set wechat.replyMode final"), { chatType: "group", isOwner: false })).toMatchObject({ allowed: false });
  expect(authorizeCommandForChat(parseCommand("/cancel"), { chatType: "group", isOwner: false })).toMatchObject({ allowed: false });
  expect(authorizeCommandForChat(parseCommand("/stop"), { chatType: "group", isOwner: false })).toMatchObject({ allowed: false });
  expect(authorizeCommandForChat(parseCommand("/clear"), { chatType: "group", isOwner: false })).toMatchObject({ allowed: false });
  expect(authorizeCommandForChat(parseCommand("/session reset"), { chatType: "group", isOwner: false })).toMatchObject({ allowed: false });
  expect(authorizeCommandForChat(parseCommand("/task approve task-1"), { chatType: "group", isOwner: false })).toMatchObject({ allowed: false });
  expect(authorizeCommandForChat(parseCommand("/dg codex fix it"), { chatType: "group", isOwner: false })).toMatchObject({ allowed: false });
  expect(authorizeCommandForChat(parseCommand("/mode auto"), { chatType: "group", isOwner: false })).toMatchObject({ allowed: false });
  expect(authorizeCommandForChat(parseCommand("/replymode stream"), { chatType: "group", isOwner: false })).toMatchObject({ allowed: false });
  expect(authorizeCommandForChat(parseCommand("/use other"), { chatType: "group", isOwner: false })).toMatchObject({ allowed: false });
  expect(authorizeCommandForChat(parseCommand("/pm set deny"), { chatType: "group", isOwner: false })).toMatchObject({ allowed: false });
  expect(authorizeCommandForChat(parseCommand("/ss new demo --agent codex --ws backend"), { chatType: "group", isOwner: false })).toMatchObject({ allowed: false });
  expect(authorizeCommandForChat(parseCommand("/session rm demo"), { chatType: "group", isOwner: false })).toMatchObject({ allowed: false });
});

test("command policy allows owner and direct chat control commands", () => {
  expect(authorizeCommandForChat(parseCommand("/permission set deny"), { chatType: "group", isOwner: true })).toEqual({ allowed: true });
  expect(authorizeCommandForChat(parseCommand("/permission set deny"), { chatType: "direct", isOwner: false })).toEqual({ allowed: true });
  expect(authorizeCommandForChat(parseCommand("/cancel"), { chatType: "direct", isOwner: false })).toEqual({ allowed: true });
  expect(authorizeCommandForChat(parseCommand("/pm set deny"), { chatType: "group", isOwner: true })).toEqual({ allowed: true });
});

test("command policy lets prompt pass in group for non-owner", () => {
  expect(authorizeCommandForChat(parseCommand("hello world"), { chatType: "group", isOwner: false })).toEqual({ allowed: true });
});

test("command policy lets invalid (recognized command with bad args) pass in group for non-owner", () => {
  expect(authorizeCommandForChat(parseCommand("/session"), { chatType: "group", isOwner: false })).toEqual({ allowed: true });
  expect(authorizeCommandForChat(parseCommand("/permission bad"), { chatType: "group", isOwner: false })).toMatchObject({ allowed: true });
});

test("renderCommandAccessDenied renders blocked message for various command kinds", () => {
  const denied = renderCommandAccessDenied(parseCommand("/pm set deny"));
  expect(denied).toContain("/permission");
  expect(denied).toContain("仅限群创建者");
});

test("allows later help in groups but gates later control commands to owner", () => {
  expect(authorizeCommandForChat(parseCommand("/later"), { chatType: "group", isOwner: false })).toEqual({ allowed: true });
  expect(authorizeCommandForChat(parseCommand("/lt"), { chatType: "group", isOwner: false })).toEqual({ allowed: true });
  expect(authorizeCommandForChat(parseCommand("/lt list"), { chatType: "group", isOwner: false })).toMatchObject({ allowed: false });
  expect(authorizeCommandForChat(parseCommand("/later cancel #K8F2"), { chatType: "group", isOwner: false })).toMatchObject({ allowed: false });
  expect(authorizeCommandForChat(parseCommand("/lt in 2h 检查 CI"), { chatType: "group", isOwner: false })).toMatchObject({ allowed: false });
  expect(authorizeCommandForChat(parseCommand("/lt list"), { chatType: "group", isOwner: true })).toEqual({ allowed: true });
  expect(authorizeCommandForChat(parseCommand("/later cancel #K8F2"), { chatType: "group", isOwner: true })).toEqual({ allowed: true });
});

test("renderCommandAccessDenied labels later commands", () => {
  const denied = renderCommandAccessDenied(parseCommand("/later cancel #K8F2"));
  expect(denied).toContain("/later cancel");
});
