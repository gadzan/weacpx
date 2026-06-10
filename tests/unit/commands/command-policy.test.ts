import { expect, test, beforeAll, afterAll } from "bun:test";

import { authorizeCommandForChat, renderCommandAccessDenied, withEffectiveOwner } from "../../../src/commands/command-policy";
import { parseCommand } from "../../../src/commands/parse-command";
import { setLocale } from "../../../src/i18n";

beforeAll(() => { setLocale("zh"); });
afterAll(() => { setLocale("en"); });

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

test("command policy blocks native session commands for non-owner group members", () => {
  expect(authorizeCommandForChat(parseCommand("/ssn"), { chatType: "group", isOwner: false })).toMatchObject({ allowed: false });
  expect(authorizeCommandForChat(parseCommand("/ssn attach 1"), { chatType: "group", isOwner: false })).toMatchObject({ allowed: false });
  expect(renderCommandAccessDenied(parseCommand("/ssn"))).toContain("/ssn");
  expect(renderCommandAccessDenied(parseCommand("/ssn attach 1"))).toContain("/ssn attach");
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

test("fail-closed: channel turn without chatType denies privileged commands", () => {
  expect(authorizeCommandForChat(parseCommand("/clear"), { channel: "feishu", senderId: "ou-1" })).toEqual({
    allowed: false,
    reason: "chat-type-missing",
  });
  expect(authorizeCommandForChat(parseCommand("/use other"), { channel: "weixin" })).toEqual({
    allowed: false,
    reason: "chat-type-missing",
  });
  // An invalid chatType value behaves like a missing one.
  expect(
    authorizeCommandForChat(parseCommand("/clear"), { channel: "feishu", chatType: "p2p" as unknown as "direct" }),
  ).toEqual({ allowed: false, reason: "chat-type-missing" });
});

test("fail-closed: channel turn without chatType still allows public commands and prompts", () => {
  expect(authorizeCommandForChat(parseCommand("/help"), { channel: "feishu" })).toEqual({ allowed: true });
  expect(authorizeCommandForChat(parseCommand("/status"), { channel: "feishu" })).toEqual({ allowed: true });
  expect(authorizeCommandForChat(parseCommand("hello world"), { channel: "feishu" })).toEqual({ allowed: true });
});

test("internal scheduled dispatch turns are exempt from the chatType fail-closed rule", () => {
  // Scheduled turns (weixin/feishu/yuanbao) carry channel + scheduledSession*
  // but no chatType; authorization happened at task creation (owner-gated).
  expect(
    authorizeCommandForChat(parseCommand("/clear"), { channel: "weixin", scheduledSessionAlias: "demo" }),
  ).toEqual({ allowed: true });
  expect(
    authorizeCommandForChat(parseCommand("/clear"), {
      channel: "weixin",
      scheduledSessionDescriptor: { alias: "tmp", agent: "codex", workspace: "backend", transportSession: "t" },
    }),
  ).toEqual({ allowed: true });
});

test("metadata-absent internal callers keep current allow-all behavior", () => {
  expect(authorizeCommandForChat(parseCommand("/clear"))).toEqual({ allowed: true });
  expect(authorizeCommandForChat(parseCommand("/clear"), {})).toEqual({ allowed: true });
  expect(authorizeCommandForChat(parseCommand("/clear"), { chatType: "direct" })).toEqual({ allowed: true });
  expect(authorizeCommandForChat(parseCommand("/clear"), { channel: "weixin", chatType: "direct" })).toEqual({
    allowed: true,
  });
});

test("renderCommandAccessDenied renders a chat-type-missing variant", () => {
  const denied = renderCommandAccessDenied(parseCommand("/clear"), "chat-type-missing");
  expect(denied).toContain("/clear");
  expect(denied).toContain("会话类型");
  expect(denied).not.toContain("仅限群创建者");
});

const ownerConfig = {
  channel: { type: "weixin", replyMode: "verbose" as const, ownerIds: ["wx-op"] },
  channels: [{ id: "feishu", type: "feishu", enabled: true, ownerIds: ["ou-op"] }],
};

test("withEffectiveOwner grants owner to senders in the channel ownerIds list", () => {
  expect(
    withEffectiveOwner({ channel: "weixin", chatType: "group", senderId: "wx-op" }, ownerConfig),
  ).toEqual({ channel: "weixin", chatType: "group", senderId: "wx-op", isOwner: true });
  expect(
    withEffectiveOwner({ channel: "feishu", chatType: "group", senderId: "ou-op" }, ownerConfig),
  ).toEqual({ channel: "feishu", chatType: "group", senderId: "ou-op", isOwner: true });
});

test("withEffectiveOwner records an explicit false for senders not in ownerIds", () => {
  expect(
    withEffectiveOwner({ channel: "weixin", chatType: "group", senderId: "wx-other" }, ownerConfig),
  ).toEqual({ channel: "weixin", chatType: "group", senderId: "wx-other", isOwner: false });
});

test("withEffectiveOwner preserves a channel-asserted isOwner", () => {
  expect(
    withEffectiveOwner({ channel: "weixin", chatType: "group", senderId: "wx-other", isOwner: true }, ownerConfig),
  ).toEqual({ channel: "weixin", chatType: "group", senderId: "wx-other", isOwner: true });
});

test("withEffectiveOwner leaves metadata unchanged when ownerIds is not configured", () => {
  const config = {
    channel: { type: "weixin", replyMode: "verbose" as const },
    channels: [{ id: "weixin", type: "weixin", enabled: true }],
  };
  const metadata = { channel: "weixin", chatType: "group" as const, senderId: "wx-1" };
  expect(withEffectiveOwner(metadata, config)).toBe(metadata);
  expect(withEffectiveOwner(metadata, undefined)).toBe(metadata);
  expect(withEffectiveOwner(undefined, ownerConfig)).toBeUndefined();
  const noChannel = { chatType: "group" as const, senderId: "wx-op" };
  expect(withEffectiveOwner(noChannel, ownerConfig)).toBe(noChannel);
});

test("withEffectiveOwner passes internal scheduled dispatch turns through untouched", () => {
  // Scheduled dispatch metadata carries no senderId/isOwner; injecting an
  // explicit isOwner: false here would flow into the recorded coordinator
  // route and overwrite a previously recorded true (input.isOwner ?? existing).
  const aliasTurn = { channel: "weixin", scheduledSessionAlias: "demo" };
  expect(withEffectiveOwner(aliasTurn, ownerConfig)).toBe(aliasTurn);
  const descriptorTurn = {
    channel: "weixin",
    scheduledSessionDescriptor: { alias: "tmp", agent: "codex", workspace: "backend", transportSession: "t" },
  };
  expect(withEffectiveOwner(descriptorTurn, ownerConfig)).toBe(descriptorTurn);
});

test("withEffectiveOwner treats an empty ownerIds list as configured (explicit revocation)", () => {
  const config = {
    channel: { type: "weixin", replyMode: "verbose" as const, ownerIds: [] },
    channels: [{ id: "weixin", type: "weixin", enabled: true }],
  };
  expect(
    withEffectiveOwner({ channel: "weixin", chatType: "group", senderId: "wx-op" }, config),
  ).toEqual({ channel: "weixin", chatType: "group", senderId: "wx-op", isOwner: false });
  // A channel-asserted owner still wins over an empty list.
  expect(
    withEffectiveOwner({ channel: "weixin", chatType: "group", senderId: "wx-op", isOwner: true }, config),
  ).toEqual({ channel: "weixin", chatType: "group", senderId: "wx-op", isOwner: true });
});

test("withEffectiveOwner matches runtime channel entries by id as well as type", () => {
  const config = {
    channel: { type: "weixin", replyMode: "verbose" as const },
    channels: [{ id: "feishu-main", type: "feishu", enabled: true, ownerIds: ["ou-op"] }],
  };
  expect(
    withEffectiveOwner({ channel: "feishu", chatType: "group", senderId: "ou-op" }, config),
  ).toEqual({ channel: "feishu", chatType: "group", senderId: "ou-op", isOwner: true });
});
