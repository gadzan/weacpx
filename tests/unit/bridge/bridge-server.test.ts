import { expect, test } from "bun:test";

import { BridgeRuntime, EnsureSessionFailedError } from "../../../src/bridge/bridge-runtime";
import { BridgeServer } from "../../../src/bridge/bridge-server";
import { PromptCommandError } from "../../../src/transport/prompt-output";

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
    [
      "--format",
      "quiet",
      "--cwd",
      "/repo",
      "--approve-all",
      "--non-interactive-permissions",
      "deny",
      "--verbose",
      "codex",
      "sessions",
      "ensure",
      "--name",
      "demo",
    ],
    [
      "--format",
      "quiet",
      "--cwd",
      "/repo",
      "--approve-all",
      "--non-interactive-permissions",
      "deny",
      "codex",
      "sessions",
      "show",
      "demo",
    ],
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
    [
      "--format",
      "quiet",
      "--cwd",
      "/repo",
      "--approve-all",
      "--non-interactive-permissions",
      "deny",
      "--verbose",
      "codex",
      "sessions",
      "ensure",
      "--name",
      "demo",
    ],
    [
      "--format",
      "quiet",
      "--cwd",
      "/repo",
      "--approve-all",
      "--non-interactive-permissions",
      "deny",
      "codex",
      "sessions",
      "show",
      "demo",
    ],
  ]);
  expect(shellCalls).toEqual([
    {
      command: "acpx",
      args: [
        "--format",
        "quiet",
        "--cwd",
        "/repo",
        "--approve-all",
        "--non-interactive-permissions",
        "deny",
        "--verbose",
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
        "--approve-all",
        "--non-interactive-permissions",
        "deny",
        "--verbose",
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
        "--approve-all",
        "--non-interactive-permissions",
        "deny",
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
        "--approve-all",
        "--non-interactive-permissions",
        "deny",
        "--verbose",
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
    [
      "--format",
      "quiet",
      "--cwd",
      "/repo",
      "--approve-all",
      "--non-interactive-permissions",
      "deny",
      "--agent",
      "./node_modules/.bin/codex-acp",
      "sessions",
      "show",
      "demo",
    ],
    [
      "--format",
      "json",
      "--json-strict",
      "--cwd",
      "/repo",
      "--approve-all",
      "--non-interactive-permissions",
      "deny",
      "--agent",
      "./node_modules/.bin/codex-acp",
      "prompt",
      "-s",
      "demo",
      "hello",
    ],
    [
      "--format",
      "quiet",
      "--cwd",
      "/repo",
      "--approve-all",
      "--non-interactive-permissions",
      "deny",
      "--agent",
      "./node_modules/.bin/codex-acp",
      "cancel",
      "-s",
      "demo",
    ],
  ]);
});

test("uses explicit permission policy for bridge runtime commands", async () => {
  const calls: string[][] = [];
  const runtime = new BridgeRuntime(
    "acpx",
    async (_command, args) => {
      calls.push(args);
      return { code: 0, stdout: "ok", stderr: "" };
    },
    undefined,
    { permissionMode: "approve-reads", nonInteractivePermissions: "deny" },
  );

  await runtime.prompt({
    agent: "codex",
    cwd: "/repo",
    name: "demo",
    text: "hello",
  });

  expect(calls).toEqual([
    [
      "--format",
      "json",
      "--json-strict",
      "--cwd",
      "/repo",
      "--approve-reads",
      "--non-interactive-permissions",
      "deny",
      "codex",
      "prompt",
      "-s",
      "demo",
      "hello",
    ],
  ]);
});

test("returns the final agent message from json-strict prompt output", async () => {
  const runtime = new BridgeRuntime("acpx", async (_command, args) => {
    if (args.includes("prompt")) {
      return {
        code: 0,
                stdout: [
          JSON.stringify({
            jsonrpc: "2.0",
            method: "session/update",
            params: {
              sessionId: "demo",
              update: {
                sessionUpdate: "agent_message_chunk",
                content: { type: "text", text: "First chunk" },
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
                content: { type: "text", text: "Final chunk" },
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
  ).resolves.toEqual({ text: "Final chunk" });
});

test("streams prompt segments from the runtime prompt runner", async () => {
  const segments: string[] = [];
  const runtime = new BridgeRuntime(
    "acpx",
    async () => ({ code: 0, stdout: "", stderr: "" }),
    async () => ({ code: 0, stdout: "", stderr: "" }),
    {},
    async (_command, _args, onEvent) => {
      onEvent?.({ type: "prompt.segment", text: "hello" });
      onEvent?.({ type: "prompt.segment", text: "world" });
      return {
        code: 0,
        stdout: JSON.stringify({
          jsonrpc: "2.0",
          method: "session/update",
          params: {
            sessionId: "demo",
            update: {
              sessionUpdate: "agent_message_chunk",
              content: { type: "text", text: "done" },
            },
          },
        }),
        stderr: "",
      };
    },
  );

  await expect(
    runtime.prompt(
      {
        agent: "codex",
        cwd: "/repo",
        name: "demo",
        text: "hello",
      },
      (event) => {
        if (event.type === "prompt.segment") {
          segments.push(event.text);
        }
      },
    ),
  ).resolves.toEqual({ text: "done" });
  expect(segments).toEqual(["hello", "world"]);
});

test("streams formatted tool_call segments when replyMode is verbose", async () => {
  const segments: string[] = [];
  const runtime = new BridgeRuntime(
    "acpx",
    async () => ({ code: 0, stdout: "", stderr: "" }),
    async () => ({ code: 0, stdout: "", stderr: "" }),
    {},
    async (_command, _args, onEvent, _options) => {
      onEvent?.({ type: "prompt.segment", text: "📖 sed -n '1,100p' src/main.ts" });
      onEvent?.({ type: "prompt.segment", text: "done" });
      return { code: 0, stdout: "", stderr: "" };
    },
  );

  await runtime.prompt(
    {
      agent: "codex",
      cwd: "/repo",
      name: "demo",
      text: "hello",
      replyMode: "verbose",
    },
    (event) => {
      if (event.type === "prompt.segment") {
        segments.push(event.text);
      }
    },
  );
  expect(segments).toEqual(["📖 sed -n '1,100p' src/main.ts", "done"]);
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
                content: { type: "text", text: "First chunk" },
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
                content: { type: "text", text: "Final chunk" },
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
  ).resolves.toEqual({ text: "Final chunk" });
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

test("streams prompt segment events before the final prompt response", async () => {
  const streamed: string[] = [];
  const runtime = {
    shutdown: async () => ({}),
    hasSession: async () => ({ exists: true }),
    ensureSession: async () => ({}),
    prompt: async (_input: Record<string, unknown>, onEvent?: (event: { type: string; text: string }) => void) => {
      onEvent?.({ type: "prompt.segment", text: "hello" });
      onEvent?.({ type: "prompt.segment", text: "world" });
      return { text: "done" };
    },
    setMode: async () => ({}),
    cancel: async () => ({ cancelled: true, message: "cancelled" }),
  };
  const server = new BridgeServer(runtime as unknown as BridgeRuntime);

  const response = await server.handleLine(
    JSON.stringify({
      id: "1",
      method: "prompt",
      params: {
        agent: "codex",
        cwd: "/repo",
        name: "demo",
        text: "hello",
      },
    }),
    (line) => {
      streamed.push(line);
    },
  );

  expect(streamed).toEqual([
    '{"id":"1","event":"prompt.segment","text":"hello"}\n',
    '{"id":"1","event":"prompt.segment","text":"world"}\n',
  ]);
  expect(response).toBe('{"id":"1","ok":true,"result":{"text":"done"}}\n');
});

function createDeferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  const promise = new Promise<T>((res) => {
    resolve = res;
  });
  return { promise, resolve };
}

async function waitForQueuedWork() {
  await new Promise<void>((resolve) => queueMicrotask(resolve));
}

test("cancel bypasses a blocked prompt for the same session", async () => {
  const promptStarted = createDeferred<void>();
  const releasePrompt = createDeferred<void>();
  const calls: string[] = [];
  const runtime = {
    shutdown: async () => ({}),
    updatePermissionPolicy: async () => ({}),
    hasSession: async () => ({ exists: true }),
    ensureSession: async () => ({}),
    prompt: async () => {
      calls.push("prompt");
      promptStarted.resolve();
      await releasePrompt.promise;
      return { text: "done" };
    },
    setMode: async () => ({}),
    cancel: async () => {
      calls.push("cancel");
      return { cancelled: true, message: "cancelled" };
    },
  } as unknown as BridgeRuntime;
  const server = new BridgeServer(runtime);

  const promptResponse = server.handleLine(JSON.stringify({
    id: "prompt-1",
    method: "prompt",
    params: {
      agent: "codex",
      cwd: "/repo",
      name: "demo",
      text: "hello",
    },
  }));

  await promptStarted.promise;

  await expect(server.handleLine(JSON.stringify({
    id: "cancel-1",
    method: "cancel",
    params: {
      agent: "codex",
      cwd: "/repo",
      name: "demo",
    },
  }))).resolves.toBe(
    '{"id":"cancel-1","ok":true,"result":{"cancelled":true,"message":"cancelled"}}\n',
  );

  expect(calls).toEqual(["prompt", "cancel"]);

  releasePrompt.resolve();
  await expect(promptResponse).resolves.toBe(
    '{"id":"prompt-1","ok":true,"result":{"text":"done"}}\n',
  );
});

test("another normal request for the same session waits behind a blocked prompt", async () => {
  const promptStarted = createDeferred<void>();
  const releasePrompt = createDeferred<void>();
  const promptFinished = createDeferred<void>();
  const calls: string[] = [];
  const runtime = {
    shutdown: async () => ({}),
    updatePermissionPolicy: async () => ({}),
    hasSession: async () => ({ exists: true }),
    ensureSession: async () => ({}),
    prompt: async () => {
      calls.push("prompt:start");
      promptStarted.resolve();
      await releasePrompt.promise;
      calls.push("prompt:end");
      promptFinished.resolve();
      return { text: "done" };
    },
    setMode: async () => {
      calls.push("setMode");
      return {};
    },
    cancel: async () => ({ cancelled: true, message: "cancelled" }),
  } as unknown as BridgeRuntime;
  const server = new BridgeServer(runtime);

  const promptResponse = server.handleLine(JSON.stringify({
    id: "prompt-2",
    method: "prompt",
    params: {
      agent: "codex",
      cwd: "/repo",
      name: "demo",
      text: "hello",
    },
  }));

  await promptStarted.promise;

  let setModeResolved = false;
  const setModeResponse = server.handleLine(JSON.stringify({
    id: "mode-1",
    method: "setMode",
    params: {
      agent: "codex",
      cwd: "/repo",
      name: "demo",
      modeId: "plan",
    },
  })).then((value) => {
    setModeResolved = true;
    return value;
  });

  await Promise.resolve();
  expect(calls).toEqual(["prompt:start"]);
  expect(setModeResolved).toBe(false);

  releasePrompt.resolve();
  await promptFinished.promise;

  await expect(promptResponse).resolves.toBe(
    '{"id":"prompt-2","ok":true,"result":{"text":"done"}}\n',
  );
  await expect(setModeResponse).resolves.toBe(
    '{"id":"mode-1","ok":true,"result":{}}\n',
  );
  expect(calls).toEqual(["prompt:start", "prompt:end", "setMode"]);
});

test("requests without a session name bypass the session scheduler", async () => {
  const promptStarted = createDeferred<void>();
  const releasePrompt = createDeferred<void>();
  const calls: string[] = [];
  const runtime = {
    shutdown: async () => ({}),
    updatePermissionPolicy: async () => {
      calls.push("updatePermissionPolicy");
      return {};
    },
    hasSession: async () => ({ exists: true }),
    ensureSession: async () => ({}),
    prompt: async () => {
      calls.push("prompt");
      promptStarted.resolve();
      await releasePrompt.promise;
      return { text: "done" };
    },
    setMode: async () => ({}),
    cancel: async () => ({ cancelled: true, message: "cancelled" }),
  } as unknown as BridgeRuntime;
  const server = new BridgeServer(runtime);

  const promptResponse = server.handleLine(JSON.stringify({
    id: "prompt-3",
    method: "prompt",
    params: {
      agent: "codex",
      cwd: "/repo",
      name: "demo",
      text: "hello",
    },
  }));

  await promptStarted.promise;

  await expect(server.handleLine(JSON.stringify({
    id: "policy-1",
    method: "updatePermissionPolicy",
    params: {
      permissionMode: "approve-all",
      nonInteractivePermissions: "deny",
    },
  }))).resolves.toBe(
    '{"id":"policy-1","ok":true,"result":{}}\n',
  );

  expect(calls).toEqual(["prompt", "updatePermissionPolicy"]);

  releasePrompt.resolve();
  await expect(promptResponse).resolves.toBe(
    '{"id":"prompt-3","ok":true,"result":{"text":"done"}}\n',
  );
});

test("session-scoped methods missing name bypass scheduler and fail immediately", async () => {
  const promptStarted = createDeferred<void>();
  const releasePrompt = createDeferred<void>();
  const calls: string[] = [];
  const runtime = {
    shutdown: async () => ({}),
    updatePermissionPolicy: async () => {
      calls.push("updatePermissionPolicy");
      return {};
    },
    hasSession: async () => ({ exists: true }),
    ensureSession: async () => ({}),
    prompt: async () => {
      calls.push("prompt");
      promptStarted.resolve();
      await releasePrompt.promise;
      return { text: "done" };
    },
    setMode: async () => ({}),
    cancel: async () => ({ cancelled: true, message: "cancelled" }),
  } as unknown as BridgeRuntime;
  const server = new BridgeServer(runtime);

  const promptResponse = server.handleLine(JSON.stringify({
    id: "prompt-5",
    method: "prompt",
    params: {
      agent: "codex",
      cwd: "/repo",
      name: "demo",
      text: "hello",
    },
  }));

  await promptStarted.promise;

  await expect(server.handleLine(JSON.stringify({
    id: "prompt-missing-name",
    method: "prompt",
    params: {
      agent: "codex",
      cwd: "/repo",
      text: "hello",
    },
  }))).resolves.toBe(
    '{"id":"prompt-missing-name","ok":false,"error":{"code":"BRIDGE_INVALID_REQUEST","message":"name must be a non-empty string"}}\n',
  );

  expect(calls).toEqual(["prompt"]);

  releasePrompt.resolve();
  await expect(promptResponse).resolves.toBe(
    '{"id":"prompt-5","ok":true,"result":{"text":"done"}}\n',
  );
});

test("non-session-scoped methods ignore scheduler even with session-like params", async () => {
  const promptStarted = createDeferred<void>();
  const releasePrompt = createDeferred<void>();
  const calls: string[] = [];
  const runtime = {
    shutdown: async () => ({}),
    updatePermissionPolicy: async () => {
      calls.push("updatePermissionPolicy");
      return {};
    },
    hasSession: async () => ({ exists: true }),
    ensureSession: async () => ({}),
    prompt: async () => {
      calls.push("prompt");
      promptStarted.resolve();
      await releasePrompt.promise;
      return { text: "done" };
    },
    setMode: async () => ({}),
    cancel: async () => ({ cancelled: true, message: "cancelled" }),
  } as unknown as BridgeRuntime;
  const server = new BridgeServer(runtime);

  const promptResponse = server.handleLine(JSON.stringify({
    id: "prompt-4",
    method: "prompt",
    params: {
      agent: "codex",
      cwd: "/repo",
      name: "demo",
      text: "hello",
    },
  }));

  await promptStarted.promise;

  const policyResponse = server.handleLine(JSON.stringify({
    id: "policy-2",
    method: "updatePermissionPolicy",
    params: {
      agent: "codex",
      cwd: "/repo",
      name: "demo",
      permissionMode: "approve-all",
      nonInteractivePermissions: "deny",
    },
  }));

  await waitForQueuedWork();
  expect(calls).toEqual(["prompt", "updatePermissionPolicy"]);

  await expect(policyResponse).resolves.toBe(
    '{"id":"policy-2","ok":true,"result":{}}\n',
  );

  releasePrompt.resolve();
  await expect(promptResponse).resolves.toBe(
    '{"id":"prompt-4","ok":true,"result":{"text":"done"}}\n',
  );
});

test("same session name in different cwd does not block through the scheduler", async () => {
  const firstPromptStarted = createDeferred<void>();
  const secondPromptStarted = createDeferred<void>();
  const releaseFirstPrompt = createDeferred<void>();
  const releaseSecondPrompt = createDeferred<void>();
  const calls: string[] = [];
  const runtime = {
    shutdown: async () => ({}),
    updatePermissionPolicy: async () => ({}),
    hasSession: async () => ({ exists: true }),
    ensureSession: async () => ({}),
    prompt: async (input: Record<string, unknown>) => {
      const cwd = input.cwd as string;
      calls.push(`prompt:${cwd}:start`);
      if (cwd === "/repo-a") {
        firstPromptStarted.resolve();
        await releaseFirstPrompt.promise;
        calls.push(`prompt:${cwd}:end`);
      }
      if (cwd === "/repo-b") {
        secondPromptStarted.resolve();
        await releaseSecondPrompt.promise;
        calls.push(`prompt:${cwd}:end`);
      }
      return { text: cwd };
    },
    setMode: async () => ({}),
    cancel: async () => ({ cancelled: true, message: "cancelled" }),
  } as unknown as BridgeRuntime;
  const server = new BridgeServer(runtime);

  const firstPromptResponse = server.handleLine(JSON.stringify({
    id: "prompt-a",
    method: "prompt",
    params: {
      agent: "codex",
      cwd: "/repo-a",
      name: "demo",
      text: "hello",
    },
  }));

  await firstPromptStarted.promise;

  const secondPromptResponse = server.handleLine(JSON.stringify({
    id: "prompt-b",
    method: "prompt",
    params: {
      agent: "codex",
      cwd: "/repo-b",
      name: "demo",
      text: "hello",
    },
  }));

  await waitForQueuedWork();
  expect(calls).toEqual([
    "prompt:/repo-a:start",
    "prompt:/repo-b:start",
  ]);

  releaseSecondPrompt.resolve();
  await expect(secondPromptStarted.promise).resolves.toBeUndefined();
  await expect(secondPromptResponse).resolves.toBe(
    '{"id":"prompt-b","ok":true,"result":{"text":"/repo-b"}}\n',
  );

  releaseFirstPrompt.resolve();
  await expect(firstPromptResponse).resolves.toBe(
    '{"id":"prompt-a","ok":true,"result":{"text":"/repo-a"}}\n',
  );
  expect(calls).toEqual([
    "prompt:/repo-a:start",
    "prompt:/repo-b:start",
    "prompt:/repo-b:end",
    "prompt:/repo-a:end",
  ]);
});

test("includes prompt diagnostics in bridge error responses", async () => {
  const runtime = {
    shutdown: async () => ({}),
    hasSession: async () => ({ exists: true }),
    ensureSession: async () => ({}),
    prompt: async () => {
      throw new PromptCommandError("command failed with exit code 5", {
        code: 5,
        stdout: "partial stdout",
        stderr: "partial stderr",
      });
    },
    cancel: async () => ({ cancelled: true, message: "cancelled" }),
  } as unknown as BridgeRuntime;
  const server = new BridgeServer(runtime);

  await expect(
    server.handleLine(
      JSON.stringify({
        id: "3",
        method: "prompt",
        params: {
          agent: "claude",
          cwd: "/repo",
          name: "demo",
          text: "hello",
        },
      }),
    ),
  ).resolves.toEqual(
    '{"id":"3","ok":false,"error":{"code":"BRIDGE_INTERNAL_ERROR","message":"command failed with exit code 5","details":{"exitCode":5,"stdout":"partial stdout","stderr":"partial stderr"}}}\n',
  );
});

test("returns structured error for invalid json input", async () => {
  const runtime = new BridgeRuntime(
    "acpx",
    async () => ({ code: 0, stdout: "", stderr: "" }),
  );
  const server = new BridgeServer(runtime);

  await expect(server.handleLine("not-json")).resolves.toEqual(
    '{"id":"unknown","ok":false,"error":{"code":"BRIDGE_INVALID_REQUEST","message":"request must be valid JSON"}}\n',
  );
});

test("returns structured error when required params are missing", async () => {
  const runtime = new BridgeRuntime(
    "acpx",
    async () => ({ code: 0, stdout: "", stderr: "" }),
  );
  const server = new BridgeServer(runtime);

  await expect(
    server.handleLine(
      JSON.stringify({
        id: "missing-text",
        method: "prompt",
        params: {
          agent: "codex",
          cwd: "/repo",
          name: "demo",
        },
      }),
    ),
  ).resolves.toEqual(
    '{"id":"missing-text","ok":false,"error":{"code":"BRIDGE_INVALID_REQUEST","message":"text must be a non-empty string"}}\n',
  );
});

test("returns invalid-request for unknown bridge methods", async () => {
  const runtime = new BridgeRuntime(
    "acpx",
    async () => ({ code: 0, stdout: "", stderr: "" }),
  );
  const server = new BridgeServer(runtime);

  await expect(
    server.handleLine(
      JSON.stringify({
        id: "bad-method",
        method: "explode",
        params: {},
      }),
    ),
  ).resolves.toEqual(
    '{"id":"bad-method","ok":false,"error":{"code":"BRIDGE_INVALID_REQUEST","message":"unsupported bridge method: explode"}}\n',
  );
});



test("bridge-server forwards session.progress via writeLine", async () => {
  const writes: string[] = [];
  const fakeRuntime = {
    ensureSession: async (
      _input: unknown,
      onProgress?: (stage: "spawn" | "initializing" | "ready") => void,
    ) => {
      onProgress?.("spawn");
      onProgress?.("initializing");
      onProgress?.("ready");
      return {};
    },
  };
  const server = new BridgeServer(fakeRuntime as never);
  const response = await server.handleLine(
    JSON.stringify({
      id: "7",
      method: "ensureSession",
      params: { agent: "x", cwd: "/c", name: "n" },
    }),
    (line) => writes.push(line),
  );
  const progressEvents = writes
    .map((line) => JSON.parse(line))
    .filter((m) => m.event === "session.progress");
  expect(progressEvents.map((e) => e.stage)).toEqual(["spawn", "initializing", "ready"]);
  expect(JSON.parse(response).ok).toBe(true);
});

test("bridge-server serializes structured missing_optional_dep error", async () => {
  const fakeRuntime = {
    ensureSession: async () => {
      throw new EnsureSessionFailedError("boom", "missing_optional_dep", {
        package: "opencode-windows-x64",
        parentPackagePath: null,
      });
    },
  };
  const server = new BridgeServer(fakeRuntime as never);
  const response = await server.handleLine(
    JSON.stringify({
      id: "8",
      method: "ensureSession",
      params: { agent: "x", cwd: "/c", name: "n" },
    }),
  );
  const parsed = JSON.parse(response);
  expect(parsed.ok).toBe(false);
  expect(parsed.error.kind).toBe("missing_optional_dep");
  expect(parsed.error.data.package).toBe("opencode-windows-x64");
});

test("updates bridge runtime permission policy for later commands", async () => {
  const calls: string[][] = [];
  const runtime = new BridgeRuntime(
    "acpx",
    async (_command, args) => {
      calls.push(args);
      return { code: 0, stdout: "ok", stderr: "" };
    },
  );

  await runtime.updatePermissionPolicy({
    permissionMode: "approve-reads",
    nonInteractivePermissions: "deny",
  });
  await runtime.prompt({
    agent: "codex",
    cwd: "/repo",
    name: "demo",
    text: "hello",
  });

  expect(calls).toEqual([[
    "--format",
    "json",
    "--json-strict",
    "--cwd",
    "/repo",
    "--approve-reads",
    "--non-interactive-permissions",
    "deny",
    "codex",
    "prompt",
    "-s",
    "demo",
    "hello",
  ]]);
});
