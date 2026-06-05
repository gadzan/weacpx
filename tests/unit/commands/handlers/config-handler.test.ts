import { expect, test, beforeEach } from "bun:test";
import { handleConfigSet } from "../../../../src/commands/handlers/config-handler";
import { setLocale } from "../../../../src/i18n";

beforeEach(() => setLocale("zh"));

function makeContext() {
  const saved: any[] = [];
  const replaced: any[] = [];
  const config = {
    transport: { type: "acpx-cli" },
    logging: { level: "info" },
    channel: { type: "weixin", replyMode: "verbose" },
    channels: [
      { id: "weixin", type: "weixin", enabled: true },
      { id: "feishu", type: "feishu", enabled: true },
    ],
    plugins: [],
    agents: {},
    workspaces: {},
    orchestration: { allowedAgentRequestTargets: [], allowedAgentRequestRoles: [] },
  } as any;
  return {
    saved,
    replaced,
    context: {
      config,
      configStore: { save: async (c: any) => { saved.push(c); } },
      transport: {},
      replaceConfig: (c: any) => { replaced.push(c); },
    } as any,
  };
}

test("/config set channels.feishu.replyMode final writes the per-channel default", async () => {
  const { context, saved, replaced } = makeContext();
  const result = await handleConfigSet(context, "channels.feishu.replyMode", "final");
  expect(result.text).not.toContain("不支持");
  expect(saved[0].channels.find((c: any) => c.id === "feishu").replyMode).toBe("final");
  expect(saved[0].channels.find((c: any) => c.id === "weixin").replyMode).toBeUndefined();
  // Success path must also swap the in-memory runtime config, not just persist to disk.
  expect(replaced.length).toBe(1);
  expect(replaced[0].channels.find((c: any) => c.id === "feishu").replyMode).toBe("final");
});

test("/config set rejects an invalid replyMode value", async () => {
  const { context, saved } = makeContext();
  const result = await handleConfigSet(context, "channels.feishu.replyMode", "loud");
  expect(result.text).toContain("stream");
  expect(saved.length).toBe(0);
});

test("/config set rejects an unknown channel id", async () => {
  const { context, saved } = makeContext();
  const result = await handleConfigSet(context, "channels.nope.replyMode", "final");
  expect(result.text).toContain("nope");
  expect(saved.length).toBe(0);
});
