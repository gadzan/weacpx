import { expect, test } from "bun:test";

import {
  BridgeRuntime,
  runStreamingPrompt,
  selectLatestAcpxSessionIndexTmp,
  tryRepairAcpxSessionIndex,
} from "../../../src/bridge/bridge-runtime";
import type { AcpxQueueOwnerLauncher } from "../../../src/transport/acpx-queue-owner-launcher";

test("flushes buffered prompt text after timeout when no paragraph boundary arrives", async () => {
  const segments: string[] = [];
  let currentTime = 0;
  let intervalCallback: (() => void) | undefined;
  let dataHandler: ((chunk: string | Buffer) => void) | undefined;
  let closeHandler: ((code: number | null) => void) | undefined;

  const resultPromise = runStreamingPrompt(
    "acpx",
    ["prompt"],
    async (event) => {
      if (event.type === "prompt.segment") {
        segments.push(event.text);
      }
    },
    {
      spawnPrompt: () =>
        ({
          stdout: {
            setEncoding: () => {},
            on: (event: "data", handler: (chunk: string | Buffer) => void) => {
              if (event === "data") {
                dataHandler = handler;
              }
            },
          },
          stderr: {
            on: () => {},
          },
          on: (event: "close" | "error", handler: (code: number | null) => void) => {
            if (event === "close") {
              closeHandler = handler;
            }
          },
        }) as unknown as {
          stdout: { setEncoding: (encoding: string) => void; on: (event: "data", handler: (chunk: string | Buffer) => void) => void };
          stderr: { on: (event: "data" | "error", handler: (chunk: string | Buffer) => void) => void };
          on: (event: "close" | "error", handler: (code: number | null) => void) => void;
        },
      setIntervalFn: (callback) => {
        intervalCallback = callback;
        return 1;
      },
      clearIntervalFn: () => {},
      maxSegmentWaitMs: 1_000,
      flushCheckIntervalMs: 100,
      now: () => currentTime,
    },
  );

  dataHandler?.(
    `${JSON.stringify({
      method: "session/update",
      params: {
        update: {
          sessionUpdate: "agent_message_chunk",
          content: { type: "text", text: "still thinking" },
        },
      },
    })}\n`,
  );

  currentTime = 1_500;
  intervalCallback?.();

  closeHandler?.(0);
  await expect(resultPromise).resolves.toEqual({
    code: 0,
    stdout: expect.stringContaining("still thinking"),
    stderr: "",
  });
  expect(segments).toEqual(["still thinking"]);
});

test("runStreamingPrompt folds tool calls into segments when toolEventMode is 'text'", async () => {
  const segments: string[] = [];
  let dataHandler: ((chunk: string | Buffer) => void) | undefined;
  let closeHandler: ((code: number | null) => void) | undefined;

  const resultPromise = runStreamingPrompt(
    "acpx",
    ["prompt"],
    (event) => {
      if (event.type === "prompt.segment") segments.push(event.text);
    },
    {
      spawnPrompt: () =>
        ({
          stdout: {
            setEncoding: () => {},
            on: (event: "data", handler: (chunk: string | Buffer) => void) => {
              if (event === "data") dataHandler = handler;
            },
          },
          stderr: { on: () => {} },
          on: (event: "close" | "error", handler: (code: number | null) => void) => {
            if (event === "close") closeHandler = handler;
          },
        }) as never,
      setIntervalFn: () => 1,
      clearIntervalFn: () => {},
      formatToolCalls: true,
      toolEventMode: "text",
    },
  );

  dataHandler?.(`${JSON.stringify({
    method: "session/update",
    params: {
      update: {
        sessionUpdate: "tool_call",
        toolCallId: "t1",
        kind: "read",
        title: "Read File",
        rawInput: { path: "foo.ts" },
        status: "completed",
      },
    },
  })}\n`);
  closeHandler?.(0);

  await resultPromise;
  expect(segments).toHaveLength(1);
  expect(segments[0]).toContain("Read File");
  expect(segments[0]).toContain("foo.ts");
});

test("runStreamingPrompt emits structured tool events when toolEventMode is 'structured'", async () => {
  const events: unknown[] = [];
  let dataHandler: ((chunk: string | Buffer) => void) | undefined;
  let closeHandler: ((code: number | null) => void) | undefined;

  const resultPromise = runStreamingPrompt(
    "acpx",
    ["prompt"],
    (event) => events.push(event),
    {
      spawnPrompt: () =>
        ({
          stdout: {
            setEncoding: () => {},
            on: (event: "data", handler: (chunk: string | Buffer) => void) => {
              if (event === "data") dataHandler = handler;
            },
          },
          stderr: { on: () => {} },
          on: (event: "close" | "error", handler: (code: number | null) => void) => {
            if (event === "close") closeHandler = handler;
          },
        }) as never,
      setIntervalFn: () => 1,
      clearIntervalFn: () => {},
      formatToolCalls: true,
      toolEventMode: "structured",
    },
  );

  dataHandler?.(`${JSON.stringify({
    method: "session/update",
    params: {
      update: {
        sessionUpdate: "tool_call",
        toolCallId: "t1",
        kind: "execute",
        title: "Bash",
        rawInput: { command: "npm", args: ["test"] },
        status: "pending",
      },
    },
  })}\n`);
  closeHandler?.(0);

  await resultPromise;
  expect(events).toEqual([
    {
      type: "prompt.tool_event",
      event: {
        toolCallId: "t1",
        toolName: "Bash",
        kind: "execute",
        summary: "npm test",
        rawInput: { command: "npm", args: ["test"] },
        status: "running",
      },
    },
  ]);
});

test("selectLatestAcpxSessionIndexTmp ignores malformed files and picks latest timestamp", () => {
  expect(selectLatestAcpxSessionIndexTmp([
    "index.json",
    "index.json.12.bad.tmp",
    "index.json.1.100.tmp",
    "index.json.3.250.tmp",
    "index.json.2.250.tmp",
    "index.json.9.249.tmp",
  ])).toBe("index.json.3.250.tmp");
});

test("tryRepairAcpxSessionIndex copies latest tmp over index on windows", async () => {
  const calls: Array<{ from: string; to: string }> = [];
  await expect(tryRepairAcpxSessionIndex({
    platform: "win32",
    home: "C:\\Users\\alice",
    readdirFn: async () => [
      "index.json",
      "index.json.10.111.tmp",
      "index.json.11.222.tmp",
      "random.txt",
    ],
    copyFileFn: async (from, to) => {
      calls.push({ from, to });
    },
  })).resolves.toBe(true);

  expect(calls).toEqual([
    {
      from: "C:\\Users\\alice\\.acpx\\sessions\\index.json.11.222.tmp",
      to: "C:\\Users\\alice\\.acpx\\sessions\\index.json",
    },
  ]);
});

test("ensureSession retries after EPERM repair succeeds", async () => {
  const runResults = [
    { code: 1, stdout: "", stderr: "ensure failed" },
    { code: 1, stdout: "", stderr: "show failed" },
    { code: 0, stdout: "session exists now", stderr: "" },
  ];
  let repairCalls = 0;
  const runtime = new BridgeRuntime(
    "acpx",
    async () => runResults.shift() ?? { code: 0, stdout: "", stderr: "" },
    async () => ({ code: 1, stdout: "", stderr: "EPERM: rename index.json.tmp failed" }),
    {},
    undefined,
    async () => {
      repairCalls += 1;
      return true;
    },
  );

  await expect(runtime.ensureSession({
    agent: "codex",
    cwd: "/repo",
    name: "demo",
  })).resolves.toEqual({});
  expect(repairCalls).toBe(1);
});

test("prompt starts queue owner with orchestration MCP identity", async () => {
  const launches: unknown[] = [];
  const queueOwnerLauncher = {
    launch: async (input: unknown) => {
      launches.push(input);
    },
  } as Pick<AcpxQueueOwnerLauncher, "launch">;
  const run = async (_command: string, args: string[]) => {
    if (args.includes("show")) {
      return { code: 0, stdout: JSON.stringify({ acpxRecordId: "acpx-record-1" }), stderr: "" };
    }
    return { code: 0, stdout: "worker response", stderr: "" };
  };
  const runtime = new BridgeRuntime("acpx", run, undefined, {}, undefined, undefined, queueOwnerLauncher);

  await expect(runtime.prompt({
    agent: "codex",
    cwd: "/repo",
    name: "worker",
    text: "hello",
    mcpCoordinatorSession: "backend:main",
    mcpSourceHandle: "backend:claude:backend:main",
  })).resolves.toEqual({ text: "worker response" });

  expect(launches).toEqual([{
    acpxRecordId: "acpx-record-1",
    coordinatorSession: "backend:main",
    sourceHandle: "backend:claude:backend:main",
    permissionMode: "approve-all",
    nonInteractivePermissions: "deny",
  }]);
});

test("ensureSession forwards --permission-policy when configured", async () => {
  const calls: string[][] = [];
  const run = async (_command: string, args: string[]) => {
    calls.push(args);
    return { code: 0, stdout: "", stderr: "" };
  };
  const runtime = new BridgeRuntime(
    "acpx",
    run,
    async () => ({ code: 0, stdout: "", stderr: "" }),
    { permissionPolicy: "C:/policies/weacpx-policy.json" } as never,
  );

  await runtime.ensureSession({ agent: "codex", cwd: "/repo", name: "demo" });

  expect(calls).toHaveLength(1);
  expect(calls[0]).toContain("--approve-all");
  expect(calls[0]).toContain("--non-interactive-permissions");
  expect(calls[0]).toContain("deny");
  expect(calls[0]).toContain("--permission-policy");
  expect(calls[0]).toContain("C:/policies/weacpx-policy.json");
});

test("ensureSession emits spawn/initializing/ready when EPERM repair succeeds", async () => {
  const stages: EnsureSessionProgressStage[] = [];
  const runResults = [
    { code: 1, stdout: "", stderr: "ensure failed" },
    { code: 1, stdout: "", stderr: "show failed" },
    { code: 0, stdout: "session exists now", stderr: "" },
  ];
  const runtime = new BridgeRuntime(
    "acpx",
    async () => runResults.shift() ?? { code: 0, stdout: "", stderr: "" },
    async () => ({ code: 1, stdout: "", stderr: "EPERM: rename index.json.tmp failed" }),
    {},
    undefined,
    async () => true,
  );

  await runtime.ensureSession(
    { agent: "codex", cwd: "/repo", name: "demo" },
    (stage) => stages.push(stage),
  );
  expect(stages).toEqual(["spawn", "initializing", "ready"]);
});

import type { EnsureSessionProgressStage } from "../../../src/transport/acpx-bridge/acpx-bridge-protocol";

test("ensureSession emits spawn/initializing/ready progress on success", async () => {
  const stages: EnsureSessionProgressStage[] = [];
  const run = async () => ({ code: 0, stdout: "", stderr: "" });
  const runCreate = async () => ({ code: 0, stdout: "", stderr: "" });
  const runtime = new BridgeRuntime("acpx", run, runCreate);
  await runtime.ensureSession({
    agent: "codex",
    cwd: "/tmp",
    name: "x",
  }, (stage) => stages.push(stage));
  // "ensure" path returns early -> at least spawn and ready emitted
  expect(stages[0]).toBe("spawn");
  expect(stages.at(-1)).toBe("ready");
});

test("ensureSession throws MissingOptionalDepErrorInfo when stderr matches", async () => {
  const run = async () => ({ code: 1, stdout: "", stderr: "" });
  const runCreate = async () => ({
    code: 1,
    stdout: "",
    stderr: `It seems that your package manager failed to install the right version of the opencode CLI for your platform. You can try manually installing "opencode-windows-x64" package`,
  });
  const runtime = new BridgeRuntime("acpx", run, runCreate);
  let caught: unknown;
  try {
    await runtime.ensureSession({ agent: "opencode", cwd: "/tmp", name: "x" });
  } catch (err) {
    caught = err;
  }
  expect((caught as { kind?: string }).kind).toBe("missing_optional_dep");
  expect((caught as { data?: { package?: string } }).data?.package).toBe("opencode-windows-x64");
});

test("ensureSession falls back to generic kind when stderr does not match", async () => {
  const run = async () => ({ code: 1, stdout: "", stderr: "" });
  const runCreate = async () => ({ code: 1, stdout: "", stderr: "unrelated boom" });
  const runtime = new BridgeRuntime("acpx", run, runCreate);
  let caught: unknown;
  try {
    await runtime.ensureSession({ agent: "opencode", cwd: "/tmp", name: "x" });
  } catch (err) {
    caught = err;
  }
  expect((caught as { kind?: string }).kind).toBe("generic");
});

// ── toolEventMode wiring tests ───────────────────────────────────────────────

function makeSpawnPrompt(dataHandler: { current?: (chunk: string) => void }, closeHandler: { current?: (code: number | null) => void }) {
  return () => ({
    stdout: {
      setEncoding: () => {},
      on: (_event: "data", handler: (chunk: string | Buffer) => void) => {
        dataHandler.current = handler as (chunk: string) => void;
      },
    },
    stderr: { on: () => {} },
    on: (event: "close" | "error", handler: (code: number | null) => void) => {
      if (event === "close") closeHandler.current = handler;
    },
  }) as never;
}

const toolCallChunk = JSON.stringify({
  method: "session/update",
  params: {
    update: {
      sessionUpdate: "tool_call",
      toolCallId: "tc-1",
      kind: "read",
      title: "Read File",
      rawInput: { path: "src/foo.ts" },
      status: "completed",
    },
  },
}) + "\n";

test("bridge runtime emits prompt.tool_event when toolEventMode is 'structured'", async () => {
  const events: unknown[] = [];
  const dataRef: { current?: (chunk: string) => void } = {};
  const closeRef: { current?: (code: number | null) => void } = {};

  const resultPromise = runStreamingPrompt(
    "acpx",
    ["prompt"],
    (event) => events.push(event),
    {
      spawnPrompt: makeSpawnPrompt(dataRef, closeRef),
      setIntervalFn: () => 1,
      clearIntervalFn: () => {},
      formatToolCalls: true,
      toolEventMode: "structured",
    },
  );

  dataRef.current?.(toolCallChunk);
  closeRef.current?.(0);
  await resultPromise;

  // structured: only tool events, no text segment for the tool call
  expect(events.filter((e) => (e as { type: string }).type === "prompt.tool_event")).toHaveLength(1);
  expect(events.filter((e) => (e as { type: string }).type === "prompt.segment")).toHaveLength(0);
});

test("bridge runtime emits only text segments when toolEventMode is undefined (Phase 0 invariant)", async () => {
  const events: unknown[] = [];
  const dataRef: { current?: (chunk: string) => void } = {};
  const closeRef: { current?: (code: number | null) => void } = {};

  const resultPromise = runStreamingPrompt(
    "acpx",
    ["prompt"],
    (event) => events.push(event),
    {
      spawnPrompt: makeSpawnPrompt(dataRef, closeRef),
      setIntervalFn: () => 1,
      clearIntervalFn: () => {},
      formatToolCalls: true,
      // toolEventMode omitted AND toolEvents omitted → defaults to "text"
    },
  );

  dataRef.current?.(toolCallChunk);
  closeRef.current?.(0);
  await resultPromise;

  // text mode: tool call folded into a text segment, no structured event
  expect(events.filter((e) => (e as { type: string }).type === "prompt.tool_event")).toHaveLength(0);
  const segments = events.filter((e) => (e as { type: string }).type === "prompt.segment");
  expect(segments).toHaveLength(1);
  expect((segments[0] as { text: string }).text).toContain("Read File");
});

test("bridge runtime emits both text segment and tool event when toolEventMode is 'both'", async () => {
  const events: unknown[] = [];
  const dataRef: { current?: (chunk: string) => void } = {};
  const closeRef: { current?: (code: number | null) => void } = {};

  const resultPromise = runStreamingPrompt(
    "acpx",
    ["prompt"],
    (event) => events.push(event),
    {
      spawnPrompt: makeSpawnPrompt(dataRef, closeRef),
      setIntervalFn: () => 1,
      clearIntervalFn: () => {},
      formatToolCalls: true,
      toolEventMode: "both",
    },
  );

  dataRef.current?.(toolCallChunk);
  closeRef.current?.(0);
  await resultPromise;

  expect(events.filter((e) => (e as { type: string }).type === "prompt.tool_event")).toHaveLength(1);
  expect(events.filter((e) => (e as { type: string }).type === "prompt.segment")).toHaveLength(1);
});

test("bridge runtime legacy toolEvents:true maps to toolEventMode 'structured'", async () => {
  // Verify BridgeRuntime.prompt() resolves toolEventMode from the legacy toolEvents flag.
  let capturedToolEventMode: string | undefined;

  const stubPromptRunner = async (
    _cmd: string,
    _args: string[],
    _onEvent: unknown,
    opts: { toolEventMode?: string },
  ) => {
    capturedToolEventMode = opts.toolEventMode;
    return { code: 0, stdout: "", stderr: "" };
  };

  const runtime = new BridgeRuntime(
    "acpx",
    async () => ({ code: 0, stdout: "", stderr: "" }),
    undefined,
    {},
    stubPromptRunner as never,
  );

  await runtime.prompt({
    agent: "codex",
    cwd: "/repo",
    name: "s1",
    text: "hello",
    toolEvents: true, // legacy flag — should map to "structured"
  }, () => {});

  expect(capturedToolEventMode).toBe("structured");
});

test("bridge runtime omitting toolEvents and toolEventMode defaults to 'text' mode", async () => {
  let capturedToolEventMode: string | undefined;

  const stubPromptRunner = async (
    _cmd: string,
    _args: string[],
    _onEvent: unknown,
    opts: { toolEventMode?: string },
  ) => {
    capturedToolEventMode = opts.toolEventMode;
    return { code: 0, stdout: "", stderr: "" };
  };

  const runtime = new BridgeRuntime(
    "acpx",
    async () => ({ code: 0, stdout: "", stderr: "" }),
    undefined,
    {},
    stubPromptRunner as never,
  );

  await runtime.prompt({
    agent: "codex",
    cwd: "/repo",
    name: "s1",
    text: "hello",
    // toolEvents and toolEventMode both absent
  }, () => {});

  expect(capturedToolEventMode).toBe("text");
});
