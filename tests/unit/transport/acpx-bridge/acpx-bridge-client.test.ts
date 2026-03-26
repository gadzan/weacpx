import { expect, test } from "bun:test";

import {
  AcpxBridgeClient,
  buildBridgeSpawnSpec,
} from "../../../../src/transport/acpx-bridge/acpx-bridge-client";
import { encodeBridgeRequest } from "../../../../src/transport/acpx-bridge/acpx-bridge-protocol";

test("encodes a bridge request as ndjson", () => {
  expect(
    encodeBridgeRequest({
      id: "1",
      method: "ping",
      params: {},
    }),
  ).toBe('{"id":"1","method":"ping","params":{}}\n');
});

test("resolves responses by request id", async () => {
  const writes: string[] = [];
  const client = new AcpxBridgeClient((line) => {
    writes.push(line);
  });

  const pending = client.request("ping", {});
  client.handleLine('{"id":"1","ok":true,"result":{}}');

  await expect(pending).resolves.toEqual({});
  expect(writes).toEqual(['{"id":"1","method":"ping","params":{}}\n']);
});

test("rejects responses with bridge error payloads", async () => {
  const client = new AcpxBridgeClient(() => {});

  const pending = client.request("ping", {});
  client.handleLine('{"id":"1","ok":false,"error":{"code":"PING_FAILED","message":"boom"}}');

  await expect(pending).rejects.toThrow("boom");
});

test("uses direct node execution instead of `node run` when spawning the bridge", () => {
  expect(
    buildBridgeSpawnSpec({
      execPath: "/usr/local/bin/node",
      bridgeEntryPath: "/app/dist/bridge/bridge-main.js",
    }),
  ).toEqual({
    command: "/usr/local/bin/node",
    args: ["/app/dist/bridge/bridge-main.js"],
  });
});

test("keeps bun's `run` subcommand when spawning the bridge under bun", () => {
  expect(
    buildBridgeSpawnSpec({
      execPath: "/usr/local/bin/bun",
      bridgeEntryPath: "/app/src/bridge/bridge-main.ts",
    }),
  ).toEqual({
    command: "/usr/local/bin/bun",
    args: ["run", "/app/src/bridge/bridge-main.ts"],
  });
});
