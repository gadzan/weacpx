import { expect, test } from "bun:test";

import { getChannelIdFromChatKey } from "../../../src/channels/channel-scope";
import {
  createMessageChannel,
  getRegisteredChannelTypes,
  hasChannelFactory,
} from "../../../src/channels/create-channel";
import { getRegisteredChannelCliProviderTypes } from "../../../src/channels/cli/registry";
import { registerChannelPlugin } from "../../../src/channels/plugin";
import type { MessageChannelRuntime } from "../../../src/channels/types";

function fakeRuntime(id: string): MessageChannelRuntime {
  return {
    id,
    isLoggedIn: () => true,
    login: async () => id,
    logout: () => {},
    start: async () => {},
    notifyTaskCompletion: async () => {},
    notifyTaskProgress: async () => {},
    sendCoordinatorMessage: async () => {},
  };
}

test("registerChannelPlugin registers factory and chat key prefix", () => {
  registerChannelPlugin({
    type: "review-plugin-channel",
    factory: () => fakeRuntime("review-plugin-channel"),
  });

  expect(createMessageChannel("review-plugin-channel").id).toBe("review-plugin-channel");
  expect(getChannelIdFromChatKey("review-plugin-channel:default:chat_1")).toBe("review-plugin-channel");
});

test("channel registry exposes registered channel types", () => {
  expect(hasChannelFactory("weixin")).toBe(true);
  expect(getRegisteredChannelTypes()).toContain("weixin");
});

test("registerChannelPlugin rejects duplicate built-in channel type", () => {
  expect(() => registerChannelPlugin({
    type: "weixin",
    factory: () => fakeRuntime("weixin"),
  })).toThrow("channel type is already registered: weixin");
});

test("CLI provider registry exposes registered provider types", () => {
  expect(getRegisteredChannelCliProviderTypes()).toContain("weixin");
});
