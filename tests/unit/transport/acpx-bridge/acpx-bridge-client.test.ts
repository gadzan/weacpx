import { expect, test } from "bun:test";

import {
  AcpxBridgeClient,
  buildBridgeSpawnSpec,
} from "../../../../src/transport/acpx-bridge/acpx-bridge-client";
import { encodeBridgeRequest } from "../../../../src/transport/acpx-bridge/acpx-bridge-protocol";
import { PromptCommandError } from "../../../../src/transport/prompt-output";

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

test("reconstructs prompt command diagnostics from bridge error payloads", async () => {
  const client = new AcpxBridgeClient(() => {});

  const pending = client.request("prompt", {});
  client.handleLine(
    '{"id":"1","ok":false,"error":{"code":"BRIDGE_INTERNAL_ERROR","message":"command failed with exit code 5","details":{"exitCode":5,"stdout":"partial stdout","stderr":"partial stderr"}}}',
  );

  try {
    await pending;
    throw new Error("expected request to fail");
  } catch (error) {
    expect(error).toBeInstanceOf(PromptCommandError);
    expect((error as PromptCommandError).exitCode).toBe(5);
    expect((error as PromptCommandError).stdout).toBe("partial stdout");
    expect((error as PromptCommandError).stderr).toBe("partial stderr");
  }
});

test("rejects pending requests when the bridge exits before replying", async () => {
  const client = new AcpxBridgeClient(() => {});

  const pending = client.request("ping", {});
  client.handleExit(new Error("bridge process exited before responding"));

  await expect(pending).rejects.toThrow("bridge process exited before responding");
});

test("delivers prompt segment events before resolving the final response", async () => {
  const events: string[] = [];
  const client = new AcpxBridgeClient(() => {});

  const pending = client.request("prompt", {}, (event) => {
    if (event.type === "prompt.segment") {
      events.push(event.text);
    }
  });
  client.handleLine('{"id":"1","event":"prompt.segment","text":"hello"}');
  client.handleLine('{"id":"1","ok":true,"result":{"text":"done"}}');

  await expect(pending).resolves.toEqual({ text: "done" });
  expect(events).toEqual(["hello"]);
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

test("ignores malformed bridge output and keeps the pending request alive", async () => {
  const client = new AcpxBridgeClient(() => {});

  const pending = client.request("ping", {});
  expect(() => client.handleLine("not-json")).not.toThrow();
  client.handleLine('{"id":"1","ok":true,"result":{}}');

  await expect(pending).resolves.toEqual({});
});

test("rejects new requests after the bridge exits", async () => {
  const client = new AcpxBridgeClient(() => {});
  client.handleExit(new Error("bridge exited"));

  await expect(client.request("ping", {})).rejects.toThrow("bridge exited");
});

test("rejects requests when the writer signals backpressure", async () => {
  const writes: string[] = [];
  const client = new AcpxBridgeClient((line) => {
    writes.push(line);
    return false;
  });

  await expect(client.request("ping", {})).rejects.toThrow("bridge write buffer is full");
  expect(writes).toEqual(['{"id":"1","method":"ping","params":{}}\n']);
});
