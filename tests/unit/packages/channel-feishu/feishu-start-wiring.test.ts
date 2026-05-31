import { expect, test } from "bun:test";

import { FeishuChannel } from "../../../../packages/channel-feishu/src/channel";
import type { FeishuChannelConfig } from "../../../../packages/channel-feishu/src/config";
import type { FeishuClientFactory } from "../../../../packages/channel-feishu/src/feishu-client";
import type { ChannelStartInput, CreateChannelDeps } from "weacpx/plugin-api";

function createNoopLogger(): ChannelStartInput["logger"] {
  return {
    debug: () => {},
    info: () => {},
    warn: () => {},
    error: () => {},
  } as unknown as ChannelStartInput["logger"];
}

function createNoopQuota(): ChannelStartInput["quota"] {
  return {
    consume: async () => ({ allowed: true }),
  } as unknown as ChannelStartInput["quota"];
}

function createDeps(overrides?: Partial<CreateChannelDeps>): CreateChannelDeps {
  return {
    // Stub client: probeBot/startWS are noops so start() completes without any
    // real WebSocket connection or network access.
    createClient: (() => ({
      sdk: { im: { message: { reply: async () => ({}), create: async () => ({}) } } },
      probeBot: async () => ({ botOpenId: "ou_bot" }),
      startWS: async () => {},
      stop: () => {},
    })) as unknown as FeishuClientFactory,
    ...overrides,
  };
}

// A valid, enabled, fully-configured account so parseFeishuChannelConfig passes.
// The stub client's startWS is a noop, so start() completes without network.
function buildConfig(): FeishuChannelConfig {
  return {
    appId: "app-id",
    appSecret: "app-secret",
  } as unknown as FeishuChannelConfig;
}

function makeChannel(): FeishuChannel {
  return new FeishuChannel(buildConfig(), createDeps());
}

test("start() captures sessions and activeTurns from ChannelStartInput", async () => {
  const sessions = {
    peekCurrentSessionAlias: () => undefined,
    setBackgroundResult: async () => {},
    takeBackgroundResult: async () => null,
    listBackgroundResultAliases: () => [],
    resolveFuzzyAlias: () => ({ kind: "none" }),
  } as any;
  const activeTurns = { markActive() {}, markInactive() {}, isActive: () => false } as any;

  const channel = makeChannel();

  await channel.start({
    agent: { chat: async () => ({ text: "" }) } as any,
    abortSignal: new AbortController().signal,
    quota: createNoopQuota(),
    logger: createNoopLogger(),
    sessions,
    activeTurns,
  } as any);

  expect((channel as any).sessions).toBe(sessions);
  expect((channel as any).activeTurns).toBe(activeTurns);
});
