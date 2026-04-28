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
