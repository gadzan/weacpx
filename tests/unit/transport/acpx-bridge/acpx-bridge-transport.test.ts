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

function createDeferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

const mcpSession: ResolvedSession = {
  ...session,
  mcpCoordinatorSession: "backend:main",
  mcpSourceHandle: "backend:claude:backend:main",
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
  }, undefined);
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

test("passes prompt media through to the bridge client", async () => {
  const request = mock(async () => ({ text: "ok" }));
  const transport = new AcpxBridgeTransport({
    request,
  });
  const media = { type: "image" as const, filePath: "/tmp/image.bin", mimeType: "image/*" };

  await expect(
    transport.prompt(session, "hello", undefined, undefined, { media }),
  ).resolves.toEqual({ text: "ok" });

  expect(request.mock.calls[0]?.[1]).toMatchObject({
    text: "hello",
    media,
  });
});

test("includes orchestration MCP identity in bridge prompt params", async () => {
  const request = mock(async () => ({ text: "ok" }));
  const transport = new AcpxBridgeTransport({ request });

  await transport.prompt(mcpSession, "hello");

  expect(request.mock.calls[0]?.[1]).toMatchObject({
    mcpCoordinatorSession: "backend:main",
    mcpSourceHandle: "backend:claude:backend:main",
  });
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
  })).resolves.toEqual({ text: "" });
  // Bridge transport batches mid segments through SegmentAggregator (both
  // arrive within the 5s window, flushed as one combined payload at finalize).
  // Returned text is empty because the streamed segments already covered all
  // user-visible content — a non-empty final would duplicate; only an
  // overflow_summary justifies a final-tier message.
  expect(segments).toEqual(["hello\nworld"]);
});


test("runs prompt segment observers serially in bridge event order", async () => {
  const request = mock(async (_method, _params, onEvent?: (event: { type: string; text: string }) => void) => {
    onEvent?.({ type: "prompt.segment", text: "first" });
    onEvent?.({ type: "prompt.segment", text: "second" });
    return { text: "done" };
  });
  const observed: string[] = [];
  const releaseFirst = createDeferred<void>();
  const transport = new AcpxBridgeTransport({ request });

  const prompt = transport.prompt(session, "hello", undefined, undefined, {
    onSegment: async (text) => {
      if (text === "first") {
        await releaseFirst.promise;
      }
      observed.push(text);
    },
  });

  await Bun.sleep(0);
  expect(observed).toEqual([]);
  releaseFirst.resolve();
  await expect(prompt).resolves.toEqual({ text: "done" });
  expect(observed).toEqual(["first", "second"]);
});

test("captures prompt segment observer failures before bridge request settles", async () => {
  const requestFinished = createDeferred<void>();
  const unhandled: unknown[] = [];
  const onUnhandled = (reason: unknown) => {
    unhandled.push(reason);
  };
  process.on("unhandledRejection", onUnhandled);
  try {
    const request = mock(async (_method, _params, onEvent?: (event: { type: string; text: string }) => void) => {
      onEvent?.({ type: "prompt.segment", text: "first" });
      await Bun.sleep(0);
      await Bun.sleep(0);
      requestFinished.resolve();
      return { text: "done" };
    });
    const transport = new AcpxBridgeTransport({ request });

    await expect(
      transport.prompt(session, "hello", undefined, undefined, {
        onSegment: () => {
          throw new Error("observer failed");
        },
      }),
    ).rejects.toThrow("observer failed");
    await requestFinished.promise;
    await Bun.sleep(0);
    expect(unhandled).toEqual([]);
  } finally {
    process.off("unhandledRejection", onUnhandled);
  }
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

test("ensureSession forwards onProgress invocations", async () => {
  let capturedOnEvent: ((e: { type: string; stage?: string }) => void) | undefined;
  const client = {
    request: async (_method: string, _params: unknown, onEvent?: (e: { type: string; stage?: string }) => void) => {
      capturedOnEvent = onEvent;
      capturedOnEvent?.({ type: "session.progress", stage: "spawn" });
      capturedOnEvent?.({ type: "session.progress", stage: "initializing" });
      return {};
    },
  };
  const transport = new AcpxBridgeTransport(client as never);
  const stages: string[] = [];
  await transport.ensureSession({
    alias: "a", agent: "x", workspace: "w", transportSession: "s", cwd: "/c",
  }, (stage) => stages.push(stage));
  expect(stages).toEqual(["spawn", "initializing"]);
});
