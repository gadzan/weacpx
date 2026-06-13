import { expect, test } from "bun:test";

import { relayCliProvider } from "../../../../packages/channel-relay/src/relay-provider";

test("parseAddArgs accepts --url/--token/--name and rejects unknown flags", () => {
  const parsed = relayCliProvider.parseAddArgs(["--url", "wss://h:8788", "--token", "tok", "--name", "pc"]);
  expect(parsed).toEqual({ ok: true, input: { url: "wss://h:8788", token: "tok", name: "pc" } });
  expect(relayCliProvider.parseAddArgs(["--bogus", "x"]).ok).toBe(false);
  expect(relayCliProvider.parseAddArgs(["--url"]).ok).toBe(false);
});

test("buildDefaultConfig/validateConfig enforce url scheme and required token", () => {
  const config = relayCliProvider.buildDefaultConfig({ url: "ws://h:8788", token: "tok", name: "pc" });
  expect(config).toEqual({
    id: "relay", type: "relay", enabled: true,
    options: { url: "ws://h:8788", pairingToken: "tok", name: "pc" },
  });
  expect(relayCliProvider.validateConfig(config)).toEqual([]);
  expect(relayCliProvider.validateConfig(relayCliProvider.buildDefaultConfig({ token: "tok" }))).toContainEqual(
    expect.objectContaining({ kind: "missing-required-field", flag: "--url" }),
  );
  expect(relayCliProvider.validateConfig(relayCliProvider.buildDefaultConfig({ url: "ws://h", }))).toContainEqual(
    expect.objectContaining({ kind: "missing-required-field", flag: "--token" }),
  );
  expect(relayCliProvider.validateConfig(relayCliProvider.buildDefaultConfig({ url: "https://h", token: "t" }))).toContainEqual(
    expect.objectContaining({ kind: "invalid-config" }),
  );
});

test("renderSummary masks the pairing token", () => {
  const config = relayCliProvider.buildDefaultConfig({ url: "ws://h:8788", token: "very-secret-token" });
  const summary = relayCliProvider.renderSummary(config).join("\n");
  expect(summary).toContain("ws://h:8788");
  expect(summary).not.toContain("very-secret-token");
});
