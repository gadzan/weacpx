import { expect, test, beforeEach } from "bun:test";
import { handleChannelCli } from "../../../../src/channels/cli/channel-cli";
import { setLocale } from "../../../../src/i18n";

beforeEach(() => setLocale("zh"));

function makeDeps(initialChannels: any[]) {
  const out: string[] = [];
  let stored = {
    channel: { type: "weixin", replyMode: "verbose" },
    channels: initialChannels,
  } as any;
  return {
    out,
    getStored: () => stored,
    deps: {
      print: (line: string) => out.push(line),
      isInteractive: () => false,
      promptText: async () => "",
      loadConfig: async () => JSON.parse(JSON.stringify(stored)),
      saveChannels: async (c: any) => { stored = { ...stored, channels: c }; },
      getDaemonStatus: async () => ({ state: "stopped" as const }),
      restartDaemon: async () => 0,
    } as any,
  };
}

test("set-reply-mode writes the channel's replyMode and reports saved", async () => {
  const { deps, getStored } = makeDeps([
    { id: "weixin", type: "weixin", enabled: true },
    { id: "feishu", type: "feishu", enabled: true },
  ]);
  const code = await handleChannelCli(["set-reply-mode", "feishu", "final"], deps);
  expect(code).toBe(0);
  expect(getStored().channels.find((c: any) => c.id === "feishu").replyMode).toBe("final");
});

test("set-reply-mode rejects an invalid mode", async () => {
  const { deps, out } = makeDeps([{ id: "weixin", type: "weixin", enabled: true }]);
  const code = await handleChannelCli(["set-reply-mode", "weixin", "loud"], deps);
  expect(code).toBe(1);
  expect(out.join("\n")).toContain("loud");
});

test("set-reply-mode rejects an unknown channel", async () => {
  const { deps, out } = makeDeps([{ id: "weixin", type: "weixin", enabled: true }]);
  const code = await handleChannelCli(["set-reply-mode", "nope", "final"], deps);
  expect(code).toBe(1);
  expect(out.join("\n")).toContain("nope");
});

test("set-reply-mode accepts a trailing --no-restart flag like the other mutating subcommands", async () => {
  const { deps, getStored } = makeDeps([
    { id: "weixin", type: "weixin", enabled: true },
    { id: "feishu", type: "feishu", enabled: true },
  ]);
  const code = await handleChannelCli(["set-reply-mode", "feishu", "stream", "--no-restart"], deps);
  expect(code).toBe(0);
  expect(getStored().channels.find((c: any) => c.id === "feishu").replyMode).toBe("stream");
});
