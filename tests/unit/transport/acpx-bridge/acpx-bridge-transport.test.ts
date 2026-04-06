import { expect, mock, test } from "bun:test";

import type { ResolvedSession } from "../../../../src/transport/types";
import { AcpxBridgeTransport } from "../../../../src/transport/acpx-bridge/acpx-bridge-transport";

const session: ResolvedSession = {
  alias: "api-fix",
  agent: "codex",
  agentCommand: "./node_modules/.bin/codex-acp",
  workspace: "backend",
  transportSession: "backend:api-fix",
  cwd: "/tmp/backend",
};

test("proxies ensureSession through the bridge client", async () => {
  const request = mock(async () => ({}));
  const transport = new AcpxBridgeTransport({
    request,
  });

  await transport.ensureSession(session);

  expect(request).toHaveBeenCalledWith("ensureSession", {
    agent: "codex",
    agentCommand: "./node_modules/.bin/codex-acp",
    cwd: "/tmp/backend",
    name: "backend:api-fix",
  });
});

test("proxies hasSession through the bridge client", async () => {
  const request = mock(async () => ({ exists: true }));
  const transport = new AcpxBridgeTransport({
    request,
  });

  await expect(transport.hasSession(session)).resolves.toBe(true);
});

test("proxies prompt through the bridge client", async () => {
  const request = mock(async () => ({ text: "ok" }));
  const transport = new AcpxBridgeTransport({
    request,
  });

  await expect(transport.prompt(session, "hello")).resolves.toEqual({ text: "ok" });
});

test("forwards bridge prompt segments into the reply callback", async () => {
  const request = mock(async (_method, _params, onEvent?: (event: { type: string; text: string }) => void) => {
    onEvent?.({ type: "prompt.segment", text: "hello" });
    onEvent?.({ type: "prompt.segment", text: "world" });
    return { text: "done" };
  });
  const segments: string[] = [];
  const transport = new AcpxBridgeTransport({
    request,
  });

  await expect(transport.prompt(session, "hello", async (text) => {
    segments.push(text);
  })).resolves.toEqual({ text: "done" });
  expect(segments).toEqual(["hello", "world"]);
});

test("proxies cancel through the bridge client", async () => {
  const request = mock(async () => ({ cancelled: true, message: "cancelled" }));
  const transport = new AcpxBridgeTransport({
    request,
  });

  await expect(transport.cancel(session)).resolves.toEqual({
    cancelled: true,
    message: "cancelled",
  });
});

test("proxies setMode through the bridge client", async () => {
  const request = mock(async () => ({}));
  const transport = new AcpxBridgeTransport({
    request,
  });

  await transport.setMode(session, "plan");

  expect(request).toHaveBeenCalledWith("setMode", {
    agent: "codex",
    agentCommand: "./node_modules/.bin/codex-acp",
    cwd: "/tmp/backend",
    name: "backend:api-fix",
    modeId: "plan",
  });
});


test("proxies permission policy updates through the bridge client", async () => {
  const request = mock(async () => ({}));
  const transport = new AcpxBridgeTransport({
    request,
  });

  await transport.updatePermissionPolicy?.({
    permissionMode: "approve-reads",
    nonInteractivePermissions: "deny",
  });

  expect(request).toHaveBeenCalledWith("updatePermissionPolicy", {
    permissionMode: "approve-reads",
    nonInteractivePermissions: "deny",
  });
});
