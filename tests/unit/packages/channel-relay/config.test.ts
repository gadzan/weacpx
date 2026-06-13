import { expect, test } from "bun:test";

import { parseRelayChannelConfig } from "../../../../packages/channel-relay/src/config";

test("parses url, pairingToken, and name", () => {
  expect(parseRelayChannelConfig({ url: "wss://hub.example.com:8788", pairingToken: "tok", name: "pc" })).toEqual({
    url: "wss://hub.example.com:8788",
    pairingToken: "tok",
    name: "pc",
  });
});

test("pairingToken and name are optional; url is required and must be ws(s)://", () => {
  expect(parseRelayChannelConfig({ url: "ws://127.0.0.1:8788" })).toEqual({ url: "ws://127.0.0.1:8788" });
  expect(() => parseRelayChannelConfig({})).toThrow(/url/);
  expect(() => parseRelayChannelConfig({ url: "https://nope" })).toThrow(/ws/);
  expect(() => parseRelayChannelConfig(undefined)).toThrow(/url/);
});
