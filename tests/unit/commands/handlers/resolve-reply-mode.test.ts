import { expect, test } from "bun:test";
import {
  resolveChannelDefaultReplyMode,
  resolveEffectiveReplyMode,
} from "../../../../src/commands/handlers/resolve-reply-mode";
import { registerKnownChannelId } from "../../../../src/channels/channel-scope";
import type { AppConfig } from "../../../../src/config/types";

// feishu must be a known channel id for getChannelIdFromChatKey to map a
// feishu:* chatKey to "feishu"; weixin is always known.
registerKnownChannelId("feishu");

function makeConfig(over: Partial<AppConfig> = {}): AppConfig {
  return {
    channel: { type: "weixin", replyMode: "verbose" },
    channels: [
      { id: "weixin", type: "weixin", enabled: true },
      { id: "feishu", type: "feishu", enabled: true, replyMode: "final" },
    ],
    ...over,
  } as AppConfig;
}

test("resolveChannelDefaultReplyMode returns the channel's replyMode", () => {
  expect(resolveChannelDefaultReplyMode(makeConfig(), "feishu:acct:chat")).toBe("final");
});

test("resolveChannelDefaultReplyMode returns undefined when channel has no replyMode", () => {
  expect(resolveChannelDefaultReplyMode(makeConfig(), "weixin:u")).toBeUndefined();
});

test("resolveChannelDefaultReplyMode returns undefined for missing config", () => {
  expect(resolveChannelDefaultReplyMode(undefined, "feishu:acct:chat")).toBeUndefined();
});

test("effective: session override wins over everything", () => {
  expect(resolveEffectiveReplyMode(makeConfig(), "feishu:acct:chat", "stream")).toBe("stream");
});

test("effective: channel default wins over global default", () => {
  expect(resolveEffectiveReplyMode(makeConfig(), "feishu:acct:chat", undefined)).toBe("final");
});

test("effective: falls back to global default when channel has none", () => {
  expect(resolveEffectiveReplyMode(makeConfig(), "weixin:u", undefined)).toBe("verbose");
});

test("effective: falls back to verbose when config is missing", () => {
  expect(resolveEffectiveReplyMode(undefined, "weixin:u", undefined)).toBe("verbose");
});
