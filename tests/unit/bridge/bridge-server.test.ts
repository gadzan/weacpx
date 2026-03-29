import { expect, test } from "bun:test";

import { BridgeRuntime } from "../../../src/bridge/bridge-runtime";
import { BridgeServer } from "../../../src/bridge/bridge-server";

test("returns whether a named session exists", async () => {
  const runtime = new BridgeRuntime(
    "acpx",
    async () => ({ code: 0, stdout: "id: abc", stderr: "" }),
  );

  await expect(
    runtime.hasSession({
      agent: "codex",
      cwd: "/repo",
      name: "demo",
    }),
  ).resolves.toEqual({ exists: true });
});

test("reuses an existing session when ensure fails but status probe finds it", async () => {
  const calls: string[][] = [];
  const runtime = new BridgeRuntime("acpx", async (_command, args) => {
    calls.push(args);
    if (args.includes("ensure")) {
      return { code: 1, stdout: "", stderr: "ensure failed" };
    }
    if (args.includes("show")) {
      return { code: 0, stdout: "id: abc", stderr: "" };
    }
    throw new Error(`unexpected command: ${args.join(" ")}`);
  });

  await expect(
    runtime.ensureSession({
      agent: "codex",
      cwd: "/repo",
      name: "demo",
    }),
  ).resolves.toEqual({});

  expect(calls).toEqual([
    ["--format", "quiet", "--cwd", "/repo", "codex", "sessions", "ensure", "--name", "demo"],
    ["--format", "quiet", "--cwd", "/repo", "codex", "sessions", "show", "demo"],
  ]);
});

test("creates a new session when ensure fails and no existing session is found", async () => {
  const calls: string[][] = [];
  const shellCalls: Array<{ command: string; args: string[]; cwd: string }> = [];
  const runtime = new BridgeRuntime(
    "acpx",
    async (_command, args) => {
      calls.push(args);
      if (args.includes("ensure")) {
        return { code: 1, stdout: "", stderr: "ensure failed" };
      }
      if (args.includes("show")) {
        return { code: 1, stdout: "", stderr: "missing" };
      }
      throw new Error(`unexpected command: ${args.join(" ")}`);
    },
    async (command, args, cwd) => {
      shellCalls.push({ command, args, cwd });
      return { code: 0, stdout: "created", stderr: "" };
    },
  );

  await expect(
    runtime.ensureSession({
      agent: "codex",
      cwd: "/repo",
      name: "demo",
    }),
  ).resolves.toEqual({});

  expect(calls).toEqual([
    ["--format", "quiet", "--cwd", "/repo", "codex", "sessions", "ensure", "--name", "demo"],
    ["--format", "quiet", "--cwd", "/repo", "codex", "sessions", "show", "demo"],
  ]);
  expect(shellCalls).toEqual([
    {
      command: "acpx",
      args: ["--format", "quiet", "--cwd", "/repo", "codex", "sessions", "new", "--name", "demo"],
      cwd: "/repo",
    },
  ]);
});

test("runs a resolved JavaScript acpx entry with the current node executable", async () => {
  const calls: Array<{ command: string; args: string[] }> = [];
  const shellCalls: Array<{ command: string; args: string[]; cwd: string }> = [];
  const runtime = new BridgeRuntime(
    "E:/global/node_modules/acpx/dist/cli.js",
    async (command, args) => {
      calls.push({ command, args });
      if (args.includes("ensure")) {
        return { code: 1, stdout: "", stderr: "ensure failed" };
      }
      if (args.includes("show")) {
        return { code: 1, stdout: "", stderr: "missing" };
      }
      throw new Error(`unexpected command: ${args.join(" ")}`);
    },
    async (command, args, cwd) => {
      shellCalls.push({ command, args, cwd });
      return { code: 0, stdout: "created", stderr: "" };
    },
  );

  await expect(
    runtime.ensureSession({
      agent: "codex",
      cwd: "/repo",
      name: "demo",
    }),
  ).resolves.toEqual({});

  expect(calls).toEqual([
    {
      command: process.execPath,
      args: [
        "E:/global/node_modules/acpx/dist/cli.js",
        "--format",
        "quiet",
        "--cwd",
        "/repo",
        "codex",
        "sessions",
        "ensure",
        "--name",
        "demo",
      ],
    },
    {
      command: process.execPath,
      args: [
        "E:/global/node_modules/acpx/dist/cli.js",
        "--format",
        "quiet",
        "--cwd",
        "/repo",
        "codex",
        "sessions",
        "show",
        "demo",
      ],
    },
  ]);
  expect(shellCalls).toEqual([
    {
      command: process.execPath,
      args: [
        "E:/global/node_modules/acpx/dist/cli.js",
        "--format",
        "quiet",
        "--cwd",
        "/repo",
        "codex",
        "sessions",
        "new",
        "--name",
        "demo",
      ],
      cwd: "/repo",
    },
  ]);
});

test("forwards an optional raw agent command to runtime operations", async () => {
  const calls: Array<Record<string, unknown>> = [];
  const runtime = {
    shutdown: async () => ({}),
    hasSession: async (input: Record<string, unknown>) => {
      calls.push(input);
      return { exists: true };
    },
    ensureSession: async (input: Record<string, unknown>) => {
      calls.push(input);
      return {};
    },
    prompt: async (input: Record<string, unknown>) => {
      calls.push(input);
      return { text: "ok" };
    },
    cancel: async (input: Record<string, unknown>) => {
      calls.push(input);
      return { cancelled: true, message: "cancelled" };
    },
  } as unknown as BridgeRuntime;
  const server = new BridgeServer(runtime);

  await server.handleLine(
    JSON.stringify({
      id: "1",
      method: "ensureSession",
      params: {
        agent: "codex",
        agentCommand: "./node_modules/.bin/codex-acp",
        cwd: "/repo",
        name: "demo",
      },
    }),
  );

  expect(calls).toEqual([
    {
      agent: "codex",
      agentCommand: "./node_modules/.bin/codex-acp",
      cwd: "/repo",
      name: "demo",
    },
  ]);
});

test("uses raw agent command for hasSession, prompt, and cancel", async () => {
  const calls: string[][] = [];
  const runtime = new BridgeRuntime("acpx", async (_command, args) => {
    calls.push(args);
    return { code: 0, stdout: "ok", stderr: "" };
  });

  await runtime.hasSession({
    agent: "codex",
    agentCommand: "./node_modules/.bin/codex-acp",
    cwd: "/repo",
    name: "demo",
  });
  await runtime.prompt({
    agent: "codex",
    agentCommand: "./node_modules/.bin/codex-acp",
    cwd: "/repo",
    name: "demo",
    text: "hello",
  });
  await runtime.cancel({
    agent: "codex",
    agentCommand: "./node_modules/.bin/codex-acp",
    cwd: "/repo",
    name: "demo",
  });

  expect(calls).toEqual([
    ["--format", "quiet", "--cwd", "/repo", "--agent", "./node_modules/.bin/codex-acp", "sessions", "show", "demo"],
    [
      "--format",
      "json",
      "--json-strict",
      "--cwd",
      "/repo",
      "--agent",
      "./node_modules/.bin/codex-acp",
      "prompt",
      "-s",
      "demo",
      "hello",
    ],
    ["--format", "quiet", "--cwd", "/repo", "--agent", "./node_modules/.bin/codex-acp", "cancel", "-s", "demo"],
  ]);
});

test("returns the final agent message from json-strict prompt output", async () => {
  const runtime = new BridgeRuntime("acpx", async (_command, args) => {
    if (args.includes("prompt")) {
      return {
        code: 0,
        stdout: [
          JSON.stringify({ jsonrpc: "2.0", id: 0, method: "initialize" }),
          JSON.stringify({
            jsonrpc: "2.0",
            method: "session/update",
            params: {
              sessionId: "demo",
              update: {
                sessionUpdate: "agent_message_chunk",
                content: { type: "text", text: "line 1" },
              },
            },
          }),
          JSON.stringify({
            jsonrpc: "2.0",
            method: "session/update",
            params: {
              sessionId: "demo",
              update: {
                sessionUpdate: "agent_message_chunk",
                content: { type: "text", text: "\nline 2" },
              },
            },
          }),
        ].join("\n"),
        stderr: "",
      };
    }

    return { code: 0, stdout: "ok", stderr: "" };
  });

  await expect(
    runtime.prompt({
      agent: "codex",
      cwd: "/repo",
      name: "demo",
      text: "hello",
    }),
  ).resolves.toEqual({ text: "line 1\nline 2" });
});

test("keeps the extracted agent reply when prompt exits non-zero without a structured error", async () => {
  const runtime = new BridgeRuntime("acpx", async (_command, args) => {
    if (args.includes("prompt")) {
      return {
        code: 1,
        stdout: [
          JSON.stringify({
            jsonrpc: "2.0",
            method: "session/update",
            params: {
              sessionId: "demo",
              update: {
                sessionUpdate: "agent_message_chunk",
                content: { type: "text", text: "先做检查。" },
              },
            },
          }),
          JSON.stringify({
            jsonrpc: "2.0",
            method: "session/update",
            params: {
              sessionId: "demo",
              update: {
                sessionUpdate: "tool_call",
                title: "Run tests",
              },
            },
          }),
          JSON.stringify({
            jsonrpc: "2.0",
            method: "session/update",
            params: {
              sessionId: "demo",
              update: {
                sessionUpdate: "agent_message_chunk",
                content: { type: "text", text: "让我更新任务状态并继续执行测试验证。" },
              },
            },
          }),
        ].join("\n"),
        stderr: "",
      };
    }

    return { code: 0, stdout: "ok", stderr: "" };
  });

  await expect(
    runtime.prompt({
      agent: "codex",
      cwd: "/repo",
      name: "demo",
      text: "hello",
    }),
  ).resolves.toEqual({ text: "让我更新任务状态并继续执行测试验证。" });
});

test("surfaces helper failures when final session creation still fails", async () => {
  const runtime = new BridgeRuntime(
    "acpx",
    async (_command, args) => {
      if (args.includes("ensure")) {
        return { code: 1, stdout: "", stderr: "ensure failed" };
      }
      if (args.includes("show")) {
        return { code: 1, stdout: "", stderr: "missing" };
      }
      throw new Error(`unexpected command: ${args.join(" ")}`);
    },
    async () => ({ code: 1, stdout: "", stderr: "helper failed" }),
  );

  await expect(
    runtime.ensureSession({
      agent: "codex",
      cwd: "/repo",
      name: "demo",
    }),
  ).rejects.toThrow("helper failed");
});

test("handles ping and shutdown over ndjson", async () => {
  const runtime = new BridgeRuntime(
    "acpx",
    async () => ({ code: 0, stdout: "", stderr: "" }),
  );
  const server = new BridgeServer(runtime);

  await expect(server.handleLine('{"id":"1","method":"ping","params":{}}')).resolves.toEqual(
    '{"id":"1","ok":true,"result":{}}\n',
  );
  await expect(server.handleLine('{"id":"2","method":"shutdown","params":{}}')).resolves.toEqual(
    '{"id":"2","ok":true,"result":{}}\n',
  );
});
