import { expect, mock, test } from "bun:test";

import {
  buildWeacpxMcpServerSpec,
  buildQueueOwnerPayload,
  AcpxQueueOwnerLauncher,
  type QueueOwnerSpawner,
  type QueueOwnerTerminator,
} from "../../../src/transport/acpx-queue-owner-launcher";

test("builds coordinator MCP server spec from a session identity", () => {
  expect(buildWeacpxMcpServerSpec({
    weacpxCommand: "node ./dist/cli.js",
    coordinatorSession: "backend:main",
  })).toEqual({
    name: "weacpx",
    type: "stdio",
    command: "node",
    args: ["./dist/cli.js", "mcp-stdio", "--coordinator-session", "backend:main", "--internal-session-tools"],
  });
});

test("builds worker MCP server spec with source handle", () => {
  expect(buildWeacpxMcpServerSpec({
    weacpxCommand: "node ./dist/cli.js",
    coordinatorSession: "backend:main",
    sourceHandle: "backend:claude:backend:main",
  })).toEqual({
    name: "weacpx",
    type: "stdio",
    command: "node",
    args: [
      "./dist/cli.js",
      "mcp-stdio",
      "--coordinator-session",
      "backend:main",
      "--source-handle",
      "backend:claude:backend:main",
    ],
  });
});

test("builds queue owner payload with MCP servers", () => {
  expect(buildQueueOwnerPayload({
    sessionId: "acpx-record-1",
    permissionMode: "approve-all",
    nonInteractivePermissions: "deny",
    mcpServers: [{ name: "weacpx", type: "stdio", command: "node", args: ["cli.js"] }],
  })).toEqual({
    sessionId: "acpx-record-1",
    permissionMode: "approve-all",
    nonInteractivePermissions: "deny",
    ttlMs: 300_000,
    maxQueueDepth: 16,
    mcpServers: [{ name: "weacpx", type: "stdio", command: "node", args: ["cli.js"] }],
  });
});

test("builds queue owner payload with prompt retries and session options", () => {
  expect(buildQueueOwnerPayload({
    sessionId: "acpx-record-1",
    permissionMode: "approve-all",
    nonInteractivePermissions: "deny",
    promptRetries: 2,
    sessionOptions: {
      model: "gpt-5",
      allowedTools: ["delegate_request"],
      maxTurns: 20,
      systemPrompt: { append: "You are a helpful assistant." },
    },
    mcpServers: [{ name: "weacpx", type: "stdio", command: "node", args: ["cli.js"] }],
  })).toEqual({
    sessionId: "acpx-record-1",
    permissionMode: "approve-all",
    nonInteractivePermissions: "deny",
    ttlMs: 300_000,
    maxQueueDepth: 16,
    promptRetries: 2,
    sessionOptions: {
      model: "gpt-5",
      allowedTools: ["delegate_request"],
      maxTurns: 20,
      systemPrompt: { append: "You are a helpful assistant." },
    },
    mcpServers: [{ name: "weacpx", type: "stdio", command: "node", args: ["cli.js"] }],
  });
});

test("terminates existing owner then starts acpx queue owner with payload", async () => {
  const spawns: Array<{ command: string; args: string[]; env: Record<string, string> }> = [];
  const spawnOwner: QueueOwnerSpawner = mock(async (command, args, options) => {
    spawns.push({ command, args, env: options.env });
  });
  const terminated: string[] = [];
  const terminateOwner: QueueOwnerTerminator = mock(async (sessionId) => {
    terminated.push(sessionId);
  });
  const launcher = new AcpxQueueOwnerLauncher({
    acpxCommand: "E:/node/acpx/dist/cli.js",
    weacpxCommand: "node ./dist/cli.js",
    spawnOwner,
    terminateOwner,
  });

  await launcher.launch({
    acpxRecordId: "acpx-record-1",
    coordinatorSession: "backend:main",
    permissionMode: "approve-all",
    nonInteractivePermissions: "deny",
  });

  expect(terminated).toEqual(["acpx-record-1"]);
  expect(spawns).toHaveLength(1);
  expect(spawns[0].command).toBe(process.execPath);
  expect(spawns[0].args).toEqual(["E:/node/acpx/dist/cli.js", "__queue-owner"]);
  const payload = JSON.parse(spawns[0].env.ACPX_QUEUE_OWNER_PAYLOAD);
  expect(payload.sessionId).toBe("acpx-record-1");
  expect(payload.mcpServers[0]).toMatchObject({
    name: "weacpx",
    command: "node",
    args: ["./dist/cli.js", "mcp-stdio", "--coordinator-session", "backend:main", "--internal-session-tools"],
  });
});

test("forwards a configured ttlMs into the queue owner payload", async () => {
  const spawns: Array<{ env: Record<string, string> }> = [];
  const launcher = new AcpxQueueOwnerLauncher({
    acpxCommand: "acpx",
    ttlMs: 1_800_000,
    spawnOwner: async (_command, _args, options) => {
      spawns.push({ env: options.env });
    },
    terminateOwner: async () => {},
  });

  await launcher.launch({
    acpxRecordId: "record-1",
    coordinatorSession: "backend:main",
    permissionMode: "approve-all",
    nonInteractivePermissions: "deny",
  });

  const payload = JSON.parse(spawns[0].env.ACPX_QUEUE_OWNER_PAYLOAD);
  expect(payload.ttlMs).toBe(1_800_000);
});

test("forwards ttlMs of 0 (keep alive forever) into the queue owner payload", async () => {
  const spawns: Array<{ env: Record<string, string> }> = [];
  const launcher = new AcpxQueueOwnerLauncher({
    acpxCommand: "acpx",
    ttlMs: 0,
    spawnOwner: async (_command, _args, options) => {
      spawns.push({ env: options.env });
    },
    terminateOwner: async () => {},
  });

  await launcher.launch({
    acpxRecordId: "record-1",
    coordinatorSession: "backend:main",
    permissionMode: "approve-all",
    nonInteractivePermissions: "deny",
  });

  const payload = JSON.parse(spawns[0].env.ACPX_QUEUE_OWNER_PAYLOAD);
  expect(payload.ttlMs).toBe(0);
});

test("cleans per-record launch locks after launch settles", async () => {
  const launcher = new AcpxQueueOwnerLauncher({
    acpxCommand: "acpx",
    spawnOwner: async () => {},
    terminateOwner: async () => {},
  });

  for (let i = 0; i < 3; i++) {
    await launcher.launch({
      acpxRecordId: `record-${i}`,
      coordinatorSession: "backend:main",
      permissionMode: "approve-all",
      nonInteractivePermissions: "deny",
    });
  }
  await Promise.resolve();

  const internals = launcher as unknown as { launchLocks: Map<string, Promise<void>> };
  expect(internals.launchLocks.size).toBe(0);
});

test("parses quoted weacpx command paths with spaces", () => {
  expect(buildWeacpxMcpServerSpec({
    weacpxCommand: '"C:/Program Files/nodejs/node.exe" "E:/projects/weacpx/dist/cli.js"',
    coordinatorSession: "backend:main",
  })).toEqual({
    name: "weacpx",
    type: "stdio",
    command: "C:/Program Files/nodejs/node.exe",
    args: ["E:/projects/weacpx/dist/cli.js", "mcp-stdio", "--coordinator-session", "backend:main", "--internal-session-tools"],
  });
});

test("uses WEACPX_DAEMON_ARG0 as the default weacpx CLI command", async () => {
  const spawns: Array<{ env: Record<string, string> }> = [];
  const launcher = new AcpxQueueOwnerLauncher({
    acpxCommand: "acpx",
    baseEnv: { WEACPX_DAEMON_ARG0: "E:/Program Files/weacpx/dist/cli.js" },
    spawnOwner: async (_command, _args, options) => {
      spawns.push({ env: options.env });
    },
    terminateOwner: async () => {},
  });

  await launcher.launch({
    acpxRecordId: "record-1",
    coordinatorSession: "backend:main",
    permissionMode: "approve-all",
    nonInteractivePermissions: "deny",
  });

  const payload = JSON.parse(spawns[0].env.ACPX_QUEUE_OWNER_PAYLOAD);
  expect(payload.mcpServers[0].command).toBe(process.execPath);
  expect(payload.mcpServers[0].args.slice(0, 2)).toEqual([
    "E:/Program Files/weacpx/dist/cli.js",
    "mcp-stdio",
  ]);
});
