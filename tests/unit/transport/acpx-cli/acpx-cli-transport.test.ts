import { expect, mock, test } from "bun:test";

import { AcpxCliTransport } from "../../../../src/transport/acpx-cli/acpx-cli-transport";
import type { ResolvedSession } from "../../../../src/transport/types";

const session: ResolvedSession = {
  alias: "api-fix",
  agent: "codex",
  agentCommand: "./node_modules/.bin/codex-acp",
  workspace: "backend",
  transportSession: "backend:api-fix",
  cwd: "/tmp/backend",
};

const aliasSession: ResolvedSession = {
  alias: "api-fix",
  agent: "codex",
  workspace: "backend",
  transportSession: "backend:api-fix",
  cwd: "/tmp/backend",
};

test("ensures a session with raw agent command by invoking acpx with the normal runner", async () => {
  const run = mock(async () => ({ code: 0, stdout: "", stderr: "" }));
  const runPty = mock(async () => ({ code: 0, stdout: "", stderr: "" }));
  const transport = new AcpxCliTransport({ command: "acpx" }, run, runPty);

  await transport.ensureSession(session);

  expect(run).toHaveBeenCalledWith("acpx", [
    "--format",
    "quiet",
    "--cwd",
    "/tmp/backend",
    "--approve-all",
    "--non-interactive-permissions",
    "fail",
    "--agent",
    "./node_modules/.bin/codex-acp",
    "sessions",
    "new",
    "--name",
    "backend:api-fix",
  ], {
    timeoutMs: 120_000,
  });
  expect(runPty).not.toHaveBeenCalled();
});

test("runs a resolved JavaScript acpx entry with the current node executable", async () => {
  const run = mock(async () => ({ code: 0, stdout: "", stderr: "" }));
  const runPty = mock(async () => ({ code: 0, stdout: "", stderr: "" }));
  const transport = new AcpxCliTransport({ command: "E:/global/node_modules/acpx/dist/cli.js" }, run, runPty);

  await transport.ensureSession(session);

  expect(run).toHaveBeenCalledWith(process.execPath, [
    "E:/global/node_modules/acpx/dist/cli.js",
    "--format",
    "quiet",
    "--cwd",
    "/tmp/backend",
    "--approve-all",
    "--non-interactive-permissions",
    "fail",
    "--agent",
    "./node_modules/.bin/codex-acp",
    "sessions",
    "new",
    "--name",
    "backend:api-fix",
  ], {
    timeoutMs: 120_000,
  });
});

test("uses 120 seconds as the default raw-command session creation timeout", async () => {
  const run = mock(async () => ({ code: 0, stdout: "", stderr: "" }));
  const runPty = mock(async () => ({ code: 0, stdout: "", stderr: "" }));
  const transport = new AcpxCliTransport({ command: "acpx" }, run, runPty);

  await transport.ensureSession(session);

  expect(run).toHaveBeenCalledWith("acpx", [
    "--format",
    "quiet",
    "--cwd",
    "/tmp/backend",
    "--approve-all",
    "--non-interactive-permissions",
    "fail",
    "--agent",
    "./node_modules/.bin/codex-acp",
    "sessions",
    "new",
    "--name",
    "backend:api-fix",
  ], {
    timeoutMs: 120_000,
  });
});

test("keeps using PTY for alias-based session creation", async () => {
  const run = mock(async () => ({ code: 0, stdout: "", stderr: "" }));
  const runPty = mock(async () => ({ code: 0, stdout: "", stderr: "" }));
  const transport = new AcpxCliTransport({ command: "acpx" }, run, runPty);

  await transport.ensureSession(aliasSession);

  expect(run).not.toHaveBeenCalled();
  expect(runPty).toHaveBeenCalledWith("acpx", [
    "--format",
    "quiet",
    "--cwd",
    "/tmp/backend",
    "--approve-all",
    "--non-interactive-permissions",
    "fail",
    "codex",
    "sessions",
    "new",
    "--name",
    "backend:api-fix",
  ], {
    timeoutMs: 120_000,
  });
});

test("fails fast when session creation does not finish before the timeout", async () => {
  const run = mock(
    async () =>
      await new Promise<never>(() => {
        // Never resolves.
      }),
  );
  const runPty = mock(async () => ({ code: 0, stdout: "", stderr: "" }));
  const transport = new AcpxCliTransport(
    { command: "acpx", sessionInitTimeoutMs: 10 },
    run,
    runPty,
  );

  await expect(transport.ensureSession(session)).rejects.toThrow(
    'acpx command timed out after 10ms: --approve-all --non-interactive-permissions fail --agent ./node_modules/.bin/codex-acp sessions new --name "backend:api-fix"',
  );
});

test("uses the normal command runner for prompt and cancel", async () => {
  const run = mock(async () => ({ code: 0, stdout: "cancelled", stderr: "" }));
  const runPty = mock(async () => ({ code: 0, stdout: "", stderr: "" }));
  const transport = new AcpxCliTransport({ command: "acpx" }, run, runPty);

  await transport.cancel(session);

  expect(run).toHaveBeenCalled();
  expect(runPty).not.toHaveBeenCalled();
});

test("uses the normal command runner for setMode", async () => {
  const run = mock(async () => ({ code: 0, stdout: "mode set: plan", stderr: "" }));
  const runPty = mock(async () => ({ code: 0, stdout: "", stderr: "" }));
  const transport = new AcpxCliTransport({ command: "acpx" }, run, runPty);

  await transport.setMode(session, "plan");

  expect(run).toHaveBeenCalledWith("acpx", [
    "--format",
    "quiet",
    "--cwd",
    "/tmp/backend",
    "--approve-all",
    "--non-interactive-permissions",
    "fail",
    "--agent",
    "./node_modules/.bin/codex-acp",
    "set-mode",
    "-s",
    "backend:api-fix",
    "plan",
  ], undefined);
  expect(runPty).not.toHaveBeenCalled();
});

test("passes default permission policy flags to prompt", async () => {
  const run = mock(async () => ({
    code: 0,
    stdout: [
      JSON.stringify({ jsonrpc: "2.0", id: 0, method: "initialize" }),
      JSON.stringify({ jsonrpc: "2.0", id: 2, result: { stopReason: "end_turn" } }),
    ].join("\n"),
    stderr: "",
  }));
  const transport = new AcpxCliTransport({ command: "acpx" }, run);

  await transport.prompt(session, "hello");

  expect(run).toHaveBeenCalledWith("acpx", [
    "--format",
    "json",
    "--json-strict",
    "--cwd",
    "/tmp/backend",
    "--approve-all",
    "--non-interactive-permissions",
    "fail",
    "--agent",
    "./node_modules/.bin/codex-acp",
    "prompt",
    "-s",
    "backend:api-fix",
    "hello",
  ]);
});

test("passes explicit permission policy flags to prompt", async () => {
  const run = mock(async () => ({
    code: 0,
    stdout: [
      JSON.stringify({ jsonrpc: "2.0", id: 0, method: "initialize" }),
      JSON.stringify({ jsonrpc: "2.0", id: 2, result: { stopReason: "end_turn" } }),
    ].join("\n"),
    stderr: "",
  }));
  const transport = new AcpxCliTransport(
    { command: "acpx", permissionMode: "approve-reads", nonInteractivePermissions: "deny" },
    run,
  );

  await transport.prompt(session, "hello");

  expect(run).toHaveBeenCalledWith("acpx", [
    "--format",
    "json",
    "--json-strict",
    "--cwd",
    "/tmp/backend",
    "--approve-reads",
    "--non-interactive-permissions",
    "deny",
    "--agent",
    "./node_modules/.bin/codex-acp",
    "prompt",
    "-s",
    "backend:api-fix",
    "hello",
  ]);
});

test("invokes cancel for the resolved session", async () => {
  const run = mock(async () => ({ code: 0, stdout: "cancelled", stderr: "" }));
  const transport = new AcpxCliTransport({ command: "acpx" }, run);

  await expect(transport.cancel(session)).resolves.toEqual({
    cancelled: true,
    message: "cancelled",
  });

  expect(run).toHaveBeenCalledWith("acpx", [
    "--format",
    "quiet",
    "--cwd",
    "/tmp/backend",
    "--approve-all",
    "--non-interactive-permissions",
    "fail",
    "--agent",
    "./node_modules/.bin/codex-acp",
    "cancel",
    "-s",
    "backend:api-fix",
  ], undefined);
});

test("checks whether a named session exists", async () => {
  const run = mock(async () => ({ code: 0, stdout: "id: abc", stderr: "" }));
  const transport = new AcpxCliTransport({ command: "acpx" }, run);

  await expect(transport.hasSession(session)).resolves.toBe(true);

  expect(run).toHaveBeenCalledWith("acpx", [
    "--format",
    "quiet",
    "--cwd",
    "/tmp/backend",
    "--approve-all",
    "--non-interactive-permissions",
    "fail",
    "--agent",
    "./node_modules/.bin/codex-acp",
    "sessions",
    "show",
    "backend:api-fix",
  ]);
});

test("returns false when a named session does not exist", async () => {
  const run = mock(async () => ({ code: 1, stdout: "", stderr: "missing" }));
  const transport = new AcpxCliTransport({ command: "acpx" }, run);

  await expect(transport.hasSession(session)).resolves.toBe(false);
});

test("returns only the last non-empty agent message segment after a non-message boundary", async () => {
  const run = mock(async () => ({
    code: 0,
    stdout: [
      JSON.stringify({ jsonrpc: "2.0", id: 0, method: "initialize" }),
      JSON.stringify({
        jsonrpc: "2.0",
        method: "session/update",
        params: {
          sessionId: "abc",
          update: {
            sessionUpdate: "agent_thought_chunk",
            content: { type: "text", text: "thinking" },
          },
        },
      }),
      JSON.stringify({
        jsonrpc: "2.0",
        method: "session/update",
        params: {
          sessionId: "abc",
          update: {
            sessionUpdate: "tool_call",
            title: "Read SKILL.md",
          },
        },
      }),
      JSON.stringify({
        jsonrpc: "2.0",
        method: "session/update",
        params: {
          sessionId: "abc",
          update: {
            sessionUpdate: "agent_message_chunk",
            content: { type: "text", text: "do" },
          },
        },
      }),
      JSON.stringify({
        jsonrpc: "2.0",
        method: "session/update",
        params: {
          sessionId: "abc",
          update: {
            sessionUpdate: "agent_message_chunk",
            content: { type: "text", text: "ne" },
          },
        },
      }),
      JSON.stringify({
        jsonrpc: "2.0",
        method: "session/update",
        params: {
          sessionId: "abc",
          update: {
            sessionUpdate: "agent_message_chunk",
            content: { type: "text", text: "" },
          },
        },
      }),
      JSON.stringify({
        jsonrpc: "2.0",
        method: "session/update",
        params: {
          sessionId: "abc",
          update: {
            sessionUpdate: "agent_message_chunk",
            content: { type: "text", text: "Using `using-superpowers` because " },
          },
        },
      }),
      JSON.stringify({
        jsonrpc: "2.0",
        method: "session/update",
        params: {
          sessionId: "abc",
          update: {
            sessionUpdate: "agent_message_chunk",
            content: { type: "text", text: "the repo instructions require a skill check." },
          },
        },
      }),
      JSON.stringify({
        jsonrpc: "2.0",
        method: "session/update",
        params: {
          sessionId: "abc",
          update: {
            sessionUpdate: "tool_call",
            title: "Read SKILL.md",
          },
        },
      }),
      JSON.stringify({
        jsonrpc: "2.0",
        method: "session/update",
        params: {
          sessionId: "abc",
          update: {
            sessionUpdate: "agent_message_chunk",
            content: { type: "text", text: "ok" },
          },
        },
      }),
      "",
    ].join("\n"),
    stderr: "",
  }));
  const transport = new AcpxCliTransport({ command: "acpx" }, run);

  await expect(transport.prompt(session, "hello")).resolves.toEqual({
    text: "ok",
  });

  expect(run).toHaveBeenCalledWith("acpx", [
    "--format",
    "json",
    "--json-strict",
    "--cwd",
    "/tmp/backend",
    "--approve-all",
    "--non-interactive-permissions",
    "fail",
    "--agent",
    "./node_modules/.bin/codex-acp",
    "prompt",
    "-s",
    "backend:api-fix",
    "hello",
  ]);
});

test("assembles the last segment from multiple consecutive message chunks", async () => {
  const run = mock(async () => ({
    code: 0,
    stdout: [
      JSON.stringify({ jsonrpc: "2.0", id: 0, method: "initialize" }),
      JSON.stringify({
        jsonrpc: "2.0",
        method: "session/update",
        params: {
          sessionId: "abc",
          update: {
            sessionUpdate: "agent_message_chunk",
            content: { type: "text", text: "Checking instructions." },
          },
        },
      }),
      JSON.stringify({
        jsonrpc: "2.0",
        method: "session/update",
        params: {
          sessionId: "abc",
          update: {
            sessionUpdate: "tool_call",
            title: "Read SKILL.md",
          },
        },
      }),
      JSON.stringify({
        jsonrpc: "2.0",
        method: "session/update",
        params: {
          sessionId: "abc",
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
          sessionId: "abc",
          update: {
            sessionUpdate: "agent_message_chunk",
            content: { type: "text", text: "\nline 2" },
          },
        },
      }),
      "",
    ].join("\n"),
    stderr: "",
  }));
  const transport = new AcpxCliTransport({ command: "acpx" }, run);

  await expect(transport.prompt(session, "hello")).resolves.toEqual({
    text: "line 1\nline 2",
  });
});

test("falls back to trimmed stdout when JSON output has no agent text chunks", async () => {
  const run = mock(async () => ({
    code: 0,
    stdout: [
      JSON.stringify({ jsonrpc: "2.0", id: 0, method: "initialize" }),
      JSON.stringify({ jsonrpc: "2.0", id: 2, result: { stopReason: "end_turn" } }),
    ].join("\n"),
    stderr: "",
  }));
  const transport = new AcpxCliTransport({ command: "acpx" }, run);

  await expect(transport.prompt(session, "hello")).resolves.toEqual({
    text: '{"jsonrpc":"2.0","id":0,"method":"initialize"}\n{"jsonrpc":"2.0","id":2,"result":{"stopReason":"end_turn"}}',
  });
});

test("strips a leading workflow preamble when a real reply follows", async () => {
  const run = mock(async () => ({
    code: 0,
    stdout: [
      JSON.stringify({
        jsonrpc: "2.0",
        method: "session/update",
        params: {
          sessionId: "abc",
          update: {
            sessionUpdate: "agent_message_chunk",
            content: {
              type: "text",
              text: "Using using-superpowers to satisfy the repo workflow requirement before responding.\n\n",
            },
          },
        },
      }),
      JSON.stringify({
        jsonrpc: "2.0",
        method: "session/update",
        params: {
          sessionId: "abc",
          update: {
            sessionUpdate: "agent_message_chunk",
            content: {
              type: "text",
              text: "Hello.",
            },
          },
        },
      }),
      "",
    ].join("\n"),
    stderr: "",
  }));
  const transport = new AcpxCliTransport({ command: "acpx" }, run);

  await expect(transport.prompt(session, "hello")).resolves.toEqual({
    text: "Hello.",
  });
});

test("keeps a genuine single-paragraph reply that starts with Using", async () => {
  const run = mock(async () => ({
    code: 0,
    stdout: [
      JSON.stringify({
        jsonrpc: "2.0",
        method: "session/update",
        params: {
          sessionId: "abc",
          update: {
            sessionUpdate: "agent_message_chunk",
            content: {
              type: "text",
              text: "Using the cache is the fastest option.",
            },
          },
        },
      }),
      "",
    ].join("\n"),
    stderr: "",
  }));
  const transport = new AcpxCliTransport({ command: "acpx" }, run);

  await expect(transport.prompt(session, "hello")).resolves.toEqual({
    text: "Using the cache is the fastest option.",
  });
});

test("raises a normalized error when acpx exits non-zero", async () => {
  const run = mock(async () => ({ code: 1, stdout: "", stderr: "session not found" }));
  const transport = new AcpxCliTransport({ command: "acpx" }, run);

  await expect(transport.prompt(session, "hello")).rejects.toThrow("session not found");
});

test("extracts the final JSON-RPC error message instead of surfacing raw payloads", async () => {
  const run = mock(async () => ({
    code: 1,
    stdout: [
      JSON.stringify({
        jsonrpc: "2.0",
        id: null,
        error: {
          code: -32603,
          message: "Resource not found",
          data: { acpxCode: "RUNTIME" },
        },
      }),
      JSON.stringify({
        jsonrpc: "2.0",
        id: null,
        error: {
          code: -32603,
          message: "Session queue owner failed to start for session 123",
          data: { acpxCode: "RUNTIME" },
        },
      }),
    ].join("\n"),
    stderr: "",
  }));
  const transport = new AcpxCliTransport({ command: "acpx" }, run);

  try {
    await transport.prompt(session, "hello");
    throw new Error("expected prompt to fail");
  } catch (error) {
    expect(error).toBeInstanceOf(Error);
    expect((error as Error).message).toBe("Session queue owner failed to start for session 123");
  }
});

test("keeps the extracted agent reply when prompt exits non-zero without a structured error", async () => {
  const run = mock(async () => ({
    code: 1,
    stdout: [
      JSON.stringify({
        jsonrpc: "2.0",
        method: "session/update",
        params: {
          sessionId: "abc",
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
          sessionId: "abc",
          update: {
            sessionUpdate: "tool_call",
            title: "Read file",
          },
        },
      }),
      JSON.stringify({
        jsonrpc: "2.0",
        method: "session/update",
        params: {
          sessionId: "abc",
          update: {
            sessionUpdate: "agent_message_chunk",
            content: { type: "text", text: "让我更新任务状态并继续执行测试验证。" },
          },
        },
      }),
    ].join("\n"),
    stderr: "",
  }));
  const transport = new AcpxCliTransport({ command: "acpx" }, run);

  await expect(transport.prompt(session, "hello")).resolves.toEqual({
    text: "让我更新任务状态并继续执行测试验证。",
  });
});
