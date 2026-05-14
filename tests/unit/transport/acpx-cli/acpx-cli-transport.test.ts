import { expect, mock, test } from "bun:test";
import { access, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { AcpxCliTransport } from "../../../../src/transport/acpx-cli/acpx-cli-transport";
import type { AcpxQueueOwnerLauncher } from "../../../../src/transport/acpx-queue-owner-launcher";
import type { ResolvedSession } from "../../../../src/transport/types";
import { QuotaManager } from "../../../../src/weixin/messaging/quota-manager";

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

async function withFakeAcpxScript(body: string, runTest: (scriptPath: string) => Promise<void>) {
  const dir = await mkdtemp(join(tmpdir(), "weacpx-acpx-cli-test-"));
  const scriptPath = join(dir, "fake-acpx.js");
  await writeFile(scriptPath, body);
  try {
    await runTest(scriptPath);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

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
    "deny",
    "--agent",
    "./node_modules/.bin/codex-acp",
    "sessions",
    "new",
    "--name",
    "backend:api-fix",
  ], expect.objectContaining({
    timeoutMs: 120_000,
  }));
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
    "deny",
    "--agent",
    "./node_modules/.bin/codex-acp",
    "sessions",
    "new",
    "--name",
    "backend:api-fix",
  ], expect.objectContaining({
    timeoutMs: 120_000,
  }));
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
    "deny",
    "--agent",
    "./node_modules/.bin/codex-acp",
    "sessions",
    "new",
    "--name",
    "backend:api-fix",
  ], expect.objectContaining({
    timeoutMs: 120_000,
  }));
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
    "deny",
    "codex",
    "sessions",
    "new",
    "--name",
    "backend:api-fix",
  ], expect.objectContaining({
    timeoutMs: 120_000,
  }));
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
    'acpx command timed out after 10ms: --approve-all --non-interactive-permissions deny --agent ./node_modules/.bin/codex-acp sessions new --name "backend:api-fix"',
  );
});


test("aborts the command runner when session creation times out", async () => {
  let aborted = false;
  const run = mock(
    async (_command: string, _args: string[], options?: { timeoutMs?: number; signal?: AbortSignal }) =>
      await new Promise<never>((_resolve, reject) => {
        options?.signal?.addEventListener("abort", () => {
          aborted = true;
          reject(new Error("runner aborted"));
        });
      }),
  );
  const runPty = mock(async () => ({ code: 0, stdout: "", stderr: "" }));
  const transport = new AcpxCliTransport(
    { command: "acpx", sessionInitTimeoutMs: 10 },
    run,
    runPty,
  );

  await expect(transport.ensureSession(session)).rejects.toThrow(
    'acpx command timed out after 10ms: --approve-all --non-interactive-permissions deny --agent ./node_modules/.bin/codex-acp sessions new --name "backend:api-fix"',
  );
  expect(aborted).toBe(true);
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
    "deny",
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
    "deny",
    "--agent",
    "./node_modules/.bin/codex-acp",
    "prompt",
    "-s",
    "backend:api-fix",
    "hello",
  ]);
});

test("writes image media prompts as structured ACP content blocks via --file", async () => {
  const mediaDir = await mkdtemp(join(tmpdir(), "weacpx-image-prompt-"));
  const mediaPath = join(mediaDir, "image.bin");
  await writeFile(mediaPath, Buffer.from("89504e470d0a1a0a", "hex"));
  let promptBlocks: unknown;
  let promptFilePath = "";
  const run = mock(async (_command: string, args: string[]) => {
    const fileFlagIndex = args.indexOf("--file");
    expect(fileFlagIndex).toBeGreaterThan(0);
    promptFilePath = args[fileFlagIndex + 1]!;
    promptBlocks = JSON.parse(await readFile(promptFilePath, "utf8"));
    return {
      code: 0,
      stdout: [
        JSON.stringify({
          method: "session/update",
          sessionId: "abc",
          params: { update: {
            sessionUpdate: "agent_message_chunk",
            content: { type: "text", text: "ok" },
          } },
        }),
      ].join("\n"),
      stderr: "",
    };
  });
  const transport = new AcpxCliTransport({ command: "acpx" }, run);

  try {
    await expect(
      transport.prompt(session, "请看图", undefined, undefined, {
        media: { type: "image", filePath: mediaPath, mimeType: "image/*" },
      }),
    ).resolves.toEqual({ text: "ok" });

    expect(run.mock.calls[0]?.[1]).toEqual([
      "--format",
      "json",
      "--json-strict",
      "--cwd",
      "/tmp/backend",
      "--approve-all",
      "--non-interactive-permissions",
      "deny",
      "--agent",
      "./node_modules/.bin/codex-acp",
      "prompt",
      "-s",
      "backend:api-fix",
      "--file",
      expect.any(String),
    ]);
    expect(promptBlocks).toEqual([
      { type: "text", text: "请看图" },
      {
        type: "image",
        mimeType: "image/png",
        data: Buffer.from("89504e470d0a1a0a", "hex").toString("base64"),
      },
    ]);
    await expect(access(promptFilePath)).rejects.toThrow();
  } finally {
    await rm(mediaDir, { recursive: true, force: true });
  }
});

test("cleans structured prompt files when image prompt command fails", async () => {
  const mediaDir = await mkdtemp(join(tmpdir(), "weacpx-image-prompt-fail-"));
  const mediaPath = join(mediaDir, "image.bin");
  await writeFile(mediaPath, Buffer.from("89504e470d0a1a0a", "hex"));
  let promptFilePath = "";
  const run = mock(async (_command: string, args: string[]) => {
    const fileFlagIndex = args.indexOf("--file");
    expect(fileFlagIndex).toBeGreaterThan(0);
    promptFilePath = args[fileFlagIndex + 1]!;
    await readFile(promptFilePath, "utf8");
    return { code: 1, stdout: "", stderr: "agent failed" };
  });
  const transport = new AcpxCliTransport({ command: "acpx" }, run);

  try {
    await expect(
      transport.prompt(session, "", undefined, undefined, {
        media: { type: "image", filePath: mediaPath, mimeType: "image/png" },
      }),
    ).rejects.toThrow("agent failed");

    await expect(access(promptFilePath)).rejects.toThrow();
  } finally {
    await rm(mediaDir, { recursive: true, force: true });
  }
});

test("CLI prompt onSegment observes streamed content without suppressing final text", async () => {
  await withFakeAcpxScript(
    `
const lines = [
  ${JSON.stringify(JSON.stringify({
    jsonrpc: "2.0",
    method: "session/update",
    params: {
      sessionId: "abc",
      update: {
        sessionUpdate: "agent_message_chunk",
        content: { type: "text", text: "progress update\n\n" },
      },
    },
  }))},
  ${JSON.stringify(JSON.stringify({
    jsonrpc: "2.0",
    method: "session/update",
    params: {
      sessionId: "abc",
      update: {
        sessionUpdate: "tool_call",
        title: "Read file",
      },
    },
  }))},
  ${JSON.stringify(JSON.stringify({
    jsonrpc: "2.0",
    method: "session/update",
    params: {
      sessionId: "abc",
      update: {
        sessionUpdate: "agent_message_chunk",
        content: { type: "text", text: "Final answer" },
      },
    },
  }))},
];
process.stdout.write(lines.join("\\n") + "\\n");
`,
    async (scriptPath) => {
      const observed: string[] = [];
      const transport = new AcpxCliTransport({ command: scriptPath });

      const result = await transport.prompt(session, "hello", undefined, undefined, {
        onSegment: (text) => {
          observed.push(text);
        },
      });

      expect(observed).toEqual(["progress update", "🔧 Read file", "Final answer"]);
      expect(result).toEqual({ text: "Final answer" });
    },
  );
});

test("CLI prompt onSegment observes segments even when reply quota drops user-facing stream", async () => {
  await withFakeAcpxScript(
    `
const lines = [
  ${JSON.stringify(JSON.stringify({
    jsonrpc: "2.0",
    method: "session/update",
    params: {
      sessionId: "abc",
      update: {
        sessionUpdate: "agent_message_chunk",
        content: { type: "text", text: "progress update\n\n" },
      },
    },
  }))},
  ${JSON.stringify(JSON.stringify({
    jsonrpc: "2.0",
    method: "session/update",
    params: {
      sessionId: "abc",
      update: {
        sessionUpdate: "agent_message_chunk",
        content: { type: "text", text: "Final answer" },
      },
    },
  }))},
];
process.stdout.write(lines.join("\\n") + "\\n");
`,
    async (scriptPath) => {
      const observed: string[] = [];
      const replied: string[] = [];
      const quota = new QuotaManager();
      for (let i = 0; i < 6; i += 1) {
        quota.reserveMidSegment("chat-1");
      }
      const transport = new AcpxCliTransport({ command: scriptPath });

      await transport.prompt(
        session,
        "hello",
        async (text) => {
          replied.push(text);
        },
        { chatKey: "chat-1", quota },
        {
          onSegment: (text) => {
            observed.push(text);
          },
        },
      );

      expect(replied).toEqual([]);
      expect(observed).toEqual(["progress update", "Final answer"]);
    },
  );
});

test("CLI prompt propagates onSegment failures when reply streaming is enabled", async () => {
  await withFakeAcpxScript(
    `
const lines = [
  ${JSON.stringify(JSON.stringify({
    jsonrpc: "2.0",
    method: "session/update",
    params: {
      sessionId: "abc",
      update: {
        sessionUpdate: "agent_message_chunk",
        content: { type: "text", text: "progress update\n\n" },
      },
    },
  }))},
];
process.stdout.write(lines.join("\\n") + "\\n");
`,
    async (scriptPath) => {
      const quota = new QuotaManager();
      const transport = new AcpxCliTransport({ command: scriptPath });

      await expect(
        transport.prompt(
          session,
          "hello",
          async () => {},
          { chatKey: "chat-1", quota },
          {
            onSegment: () => {
              throw new Error("observer failed");
            },
          },
        ),
      ).rejects.toThrow("observer failed");
    },
  );
});



test("applies updated permission policy to later commands", async () => {
  const run = mock(async () => ({
    code: 0,
    stdout: [
      JSON.stringify({ jsonrpc: "2.0", id: 0, method: "initialize" }),
      JSON.stringify({ jsonrpc: "2.0", id: 2, result: { stopReason: "end_turn" } }),
    ].join("\n"),
    stderr: "",
  }));
  const transport = new AcpxCliTransport({ command: "acpx" }, run);

  await transport.updatePermissionPolicy?.({
    permissionMode: "approve-reads",
    nonInteractivePermissions: "deny",
  });
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
    "deny",
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
    "deny",
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
    "deny",
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

test("starts a queue owner with orchestration MCP before prompting an MCP-bound session", async () => {
  const mcpSession: ResolvedSession = {
    ...session,
    mcpCoordinatorSession: "backend:main",
    mcpSourceHandle: "backend:claude:backend:main",
  };
  const run = mock(async (_command: string, args: string[]) => {
    if (args.includes("show")) {
      return {
        code: 0,
        stdout: JSON.stringify({ acpxRecordId: "acpx-record-1" }),
        stderr: "",
      };
    }
    return { code: 0, stdout: "worker response", stderr: "" };
  });
  const launches: unknown[] = [];
  const queueOwnerLauncher = {
    launch: async (input: unknown) => {
      launches.push(input);
    },
  } as Pick<AcpxQueueOwnerLauncher, "launch">;
  const transport = new AcpxCliTransport(
    { command: "acpx" },
    run,
    undefined,
    queueOwnerLauncher,
  );

  await expect(transport.prompt(mcpSession, "hello")).resolves.toEqual({ text: "worker response" });

  expect(launches).toEqual([{
    acpxRecordId: "acpx-record-1",
    coordinatorSession: "backend:main",
    sourceHandle: "backend:claude:backend:main",
    permissionMode: "approve-all",
    nonInteractivePermissions: "deny",
  }]);
});

// --- toolEventMode wiring tests ---

function makeToolCallLine(toolCallId: string, title: string, kind = "read"): string {
  return JSON.stringify({
    jsonrpc: "2.0",
    method: "session/update",
    params: {
      sessionId: "abc",
      update: {
        sessionUpdate: "tool_call",
        toolCallId,
        title,
        kind,
      },
    },
  });
}

function makeAgentChunkLine(text: string): string {
  return JSON.stringify({
    jsonrpc: "2.0",
    method: "session/update",
    params: {
      sessionId: "abc",
      update: {
        sessionUpdate: "agent_message_chunk",
        content: { type: "text", text },
      },
    },
  });
}

function makeFakeSpawn(lines: string[]) {
  let dataHandler: ((chunk: string) => void) | undefined;
  let closeHandler: ((code: number | null) => void) | undefined;

  const process = {
    stdout: {
      setEncoding: () => {},
      on: (event: string, handler: (chunk: string) => void) => {
        if (event === "data") dataHandler = handler;
      },
    },
    stderr: {
      on: () => {},
    },
    on: (event: string, handler: (code: number | null) => void) => {
      if (event === "close") closeHandler = handler;
    },
  };

  Promise.resolve().then(() => {
    dataHandler?.(lines.join("\n") + "\n");
    closeHandler?.(0);
  });

  return process as unknown as ReturnType<typeof makeFakeSpawn>;
}

test("toolEventMode: no onToolEvent + no toolEventMode → resolves to text, tool call appears as segment", async () => {
  const segments: string[] = [];
  const toolEvents: unknown[] = [];

  const transport = new AcpxCliTransport(
    { command: "acpx" },
    undefined,
    undefined,
    undefined,
    {
      spawnPrompt: () => makeFakeSpawn([
        makeToolCallLine("id-1", "Read file", "read"),
        makeAgentChunkLine("done"),
      ]),
      setIntervalFn: () => 0,
      clearIntervalFn: () => {},
    },
  );

  const sessionWithVerboseMode: typeof session = { ...session, replyMode: "verbose" };
  await transport.prompt(sessionWithVerboseMode, "hello", async (text) => {
    segments.push(text);
  }, undefined);

  expect(toolEvents).toEqual([]);
  expect(segments.some((s) => s.includes("Read file"))).toBe(true);
});

test("toolEventMode: onToolEvent + no toolEventMode → resolves to structured, callback receives event, no text segment for the tool call", async () => {
  const segments: string[] = [];
  const toolEvents: unknown[] = [];

  const transport = new AcpxCliTransport(
    { command: "acpx" },
    undefined,
    undefined,
    undefined,
    {
      spawnPrompt: () => makeFakeSpawn([
        makeToolCallLine("id-2", "Run tests", "execute"),
        makeAgentChunkLine("final"),
      ]),
      setIntervalFn: () => 0,
      clearIntervalFn: () => {},
    },
  );

  const sessionWithVerboseMode: typeof session = { ...session, replyMode: "verbose" };
  await transport.prompt(sessionWithVerboseMode, "hello", async (text) => {
    segments.push(text);
  }, undefined, {
    onToolEvent: (event) => {
      toolEvents.push(event);
    },
  });

  expect(toolEvents).toHaveLength(1);
  expect((toolEvents[0] as { toolName: string }).toolName).toBe("Run tests");
  expect(segments.every((s) => !s.includes("Run tests"))).toBe(true);
});

test("toolEventMode: explicit 'both' + onToolEvent → callback receives event AND text segment emitted", async () => {
  const segments: string[] = [];
  const toolEvents: unknown[] = [];

  const transport = new AcpxCliTransport(
    { command: "acpx" },
    undefined,
    undefined,
    undefined,
    {
      spawnPrompt: () => makeFakeSpawn([
        makeToolCallLine("id-3", "Grep for pattern", "search"),
        makeAgentChunkLine("done"),
      ]),
      setIntervalFn: () => 0,
      clearIntervalFn: () => {},
    },
  );

  const sessionWithVerboseMode: typeof session = { ...session, replyMode: "verbose" };
  await transport.prompt(sessionWithVerboseMode, "hello", async (text) => {
    segments.push(text);
  }, undefined, {
    toolEventMode: "both",
    onToolEvent: (event) => {
      toolEvents.push(event);
    },
  });

  expect(toolEvents).toHaveLength(1);
  expect((toolEvents[0] as { toolName: string }).toolName).toBe("Grep for pattern");
  expect(segments.some((s) => s.includes("Grep for pattern"))).toBe(true);
});

test("toolEventMode: explicit 'text' with onToolEvent → text segment only, callback NOT invoked", async () => {
  const segments: string[] = [];
  const toolEvents: unknown[] = [];

  const transport = new AcpxCliTransport(
    { command: "acpx" },
    undefined,
    undefined,
    undefined,
    {
      spawnPrompt: () => makeFakeSpawn([
        makeToolCallLine("id-4", "Edit file", "edit"),
        makeAgentChunkLine("done"),
      ]),
      setIntervalFn: () => 0,
      clearIntervalFn: () => {},
    },
  );

  const sessionWithVerboseMode: typeof session = { ...session, replyMode: "verbose" };
  await transport.prompt(sessionWithVerboseMode, "hello", async (text) => {
    segments.push(text);
  }, undefined, {
    toolEventMode: "text",
    onToolEvent: (event) => {
      toolEvents.push(event);
    },
  });

  expect(toolEvents).toHaveLength(0);
  expect(segments.some((s) => s.includes("Edit file"))).toBe(true);
});

// --- onToolEvent chain serialization tests ---

test("onToolEvent: events delivered in emission order even when first handler is slow", async () => {
  const recorder: string[] = [];

  const transport = new AcpxCliTransport(
    { command: "acpx" },
    undefined,
    undefined,
    undefined,
    {
      spawnPrompt: () => makeFakeSpawn([
        makeToolCallLine("id-1", "Tool One", "read"),
        makeToolCallLine("id-2", "Tool Two", "read"),
        makeToolCallLine("id-3", "Tool Three", "read"),
        makeAgentChunkLine("done"),
      ]),
      setIntervalFn: () => 0,
      clearIntervalFn: () => {},
    },
  );

  const sessionWithVerboseMode: typeof session = { ...session, replyMode: "verbose" };
  await transport.prompt(sessionWithVerboseMode, "hello", async () => {}, undefined, {
    onToolEvent: async (event) => {
      if (event.toolCallId === "id-1") {
        await new Promise<void>((r) => setTimeout(r, 10));
      }
      recorder.push(event.toolCallId);
    },
  });

  expect(recorder).toEqual(["id-1", "id-2", "id-3"]);
});

test("onToolEvent: prompt does not resolve until the handler chain settles", async () => {
  let handlerResolve!: () => void;
  const handlerSettled = new Promise<void>((r) => { handlerResolve = r; });
  const order: string[] = [];

  const transport = new AcpxCliTransport(
    { command: "acpx" },
    undefined,
    undefined,
    undefined,
    {
      spawnPrompt: () => makeFakeSpawn([
        makeToolCallLine("id-1", "Tool One", "read"),
        makeAgentChunkLine("done"),
      ]),
      setIntervalFn: () => 0,
      clearIntervalFn: () => {},
    },
  );

  const sessionWithVerboseMode: typeof session = { ...session, replyMode: "verbose" };

  // Kick off the prompt without awaiting it yet.
  const promptPromise = transport.prompt(sessionWithVerboseMode, "hello", async () => {}, undefined, {
    onToolEvent: async () => {
      await handlerSettled;
      order.push("handler");
    },
  });

  // Give the spawn event loop a chance to fire (data + close).
  await new Promise<void>((r) => setTimeout(r, 20));

  // Prompt must still be pending because the handler hasn't settled.
  let promptResolved = false;
  void promptPromise.then(() => { promptResolved = true; });
  await Promise.resolve(); // flush microtask
  expect(promptResolved).toBe(false);

  // Now resolve the handler.
  handlerResolve();
  order.push("released");

  await promptPromise;
  order.push("prompt");

  // Handler must have completed before prompt resolved.
  expect(order[0]).toBe("released");
  expect(order[1]).toBe("handler");
  expect(order[2]).toBe("prompt");
});

test("onToolEvent: handler error rejects the prompt", async () => {
  const transport = new AcpxCliTransport(
    { command: "acpx" },
    undefined,
    undefined,
    undefined,
    {
      spawnPrompt: () => makeFakeSpawn([
        makeToolCallLine("id-1", "Tool One", "read"),
        makeAgentChunkLine("done"),
      ]),
      setIntervalFn: () => 0,
      clearIntervalFn: () => {},
    },
  );

  const sessionWithVerboseMode: typeof session = { ...session, replyMode: "verbose" };
  await expect(
    transport.prompt(sessionWithVerboseMode, "hello", async () => {}, undefined, {
      onToolEvent: () => {
        throw new Error("handler boom");
      },
    }),
  ).rejects.toThrow("handler boom");
});

test("onToolEvent: only the first handler error is surfaced", async () => {
  const transport = new AcpxCliTransport(
    { command: "acpx" },
    undefined,
    undefined,
    undefined,
    {
      spawnPrompt: () => makeFakeSpawn([
        makeToolCallLine("id-1", "Tool One", "read"),
        makeToolCallLine("id-2", "Tool Two", "read"),
        makeAgentChunkLine("done"),
      ]),
      setIntervalFn: () => 0,
      clearIntervalFn: () => {},
    },
  );

  const sessionWithVerboseMode: typeof session = { ...session, replyMode: "verbose" };
  await expect(
    transport.prompt(sessionWithVerboseMode, "hello", async () => {}, undefined, {
      onToolEvent: (event) => {
        throw new Error(`error from ${event.toolCallId}`);
      },
    }),
  ).rejects.toThrow("error from id-1");
});

test("onToolEvent: later handlers still run even when an earlier one errors", async () => {
  const recorder: string[] = [];

  const transport = new AcpxCliTransport(
    { command: "acpx" },
    undefined,
    undefined,
    undefined,
    {
      spawnPrompt: () => makeFakeSpawn([
        makeToolCallLine("id-1", "Tool One", "read"),
        makeToolCallLine("id-2", "Tool Two", "read"),
        makeAgentChunkLine("done"),
      ]),
      setIntervalFn: () => 0,
      clearIntervalFn: () => {},
    },
  );

  const sessionWithVerboseMode: typeof session = { ...session, replyMode: "verbose" };
  await expect(
    transport.prompt(sessionWithVerboseMode, "hello", async () => {}, undefined, {
      onToolEvent: (event) => {
        recorder.push(event.toolCallId);
        if (event.toolCallId === "id-1") {
          throw new Error("first handler error");
        }
      },
    }),
  ).rejects.toThrow("first handler error");

  // id-2 must have been called despite id-1 throwing.
  expect(recorder).toEqual(["id-1", "id-2"]);
});

test("onToolEvent: text mode does not invoke the callback at all", async () => {
  const called: unknown[] = [];

  const transport = new AcpxCliTransport(
    { command: "acpx" },
    undefined,
    undefined,
    undefined,
    {
      spawnPrompt: () => makeFakeSpawn([
        makeToolCallLine("id-1", "Tool One", "read"),
        makeAgentChunkLine("done"),
      ]),
      setIntervalFn: () => 0,
      clearIntervalFn: () => {},
    },
  );

  const sessionWithVerboseMode: typeof session = { ...session, replyMode: "verbose" };
  await expect(
    transport.prompt(sessionWithVerboseMode, "hello", async () => {}, undefined, {
      toolEventMode: "text",
      onToolEvent: (event) => {
        called.push(event);
      },
    }),
  ).resolves.toBeDefined();

  expect(called).toHaveLength(0);
});

// --- R1: toolEventMode demotion when onToolEvent is absent ---

test("R1: explicit toolEventMode:'structured' without onToolEvent → tool call lands in reply stream (text fallback)", async () => {
  const segments: string[] = [];

  const transport = new AcpxCliTransport(
    { command: "acpx" },
    undefined,
    undefined,
    undefined,
    {
      spawnPrompt: () => makeFakeSpawn([
        makeToolCallLine("id-r1", "Demoted tool", "read"),
        makeAgentChunkLine("final"),
      ]),
      setIntervalFn: () => 0,
      clearIntervalFn: () => {},
    },
  );

  const sessionWithVerboseMode: typeof session = { ...session, replyMode: "verbose" };
  await transport.prompt(sessionWithVerboseMode, "hello", async (text) => {
    segments.push(text);
  }, undefined, {
    toolEventMode: "structured",
    // no onToolEvent — the transport must demote to 'text'
  });

  // Tool call must surface as text, not be silently dropped.
  expect(segments.some((s) => s.includes("Demoted tool"))).toBe(true);
});

test("R1: explicit toolEventMode:'both' without onToolEvent → tool call lands in reply stream (text fallback)", async () => {
  const segments: string[] = [];

  const transport = new AcpxCliTransport(
    { command: "acpx" },
    undefined,
    undefined,
    undefined,
    {
      spawnPrompt: () => makeFakeSpawn([
        makeToolCallLine("id-r1b", "Both demoted tool", "read"),
        makeAgentChunkLine("final"),
      ]),
      setIntervalFn: () => 0,
      clearIntervalFn: () => {},
    },
  );

  const sessionWithVerboseMode: typeof session = { ...session, replyMode: "verbose" };
  await transport.prompt(sessionWithVerboseMode, "hello", async (text) => {
    segments.push(text);
  }, undefined, {
    toolEventMode: "both",
    // no onToolEvent — the transport must demote to 'text'
  });

  // The 'both' mode already produces text segments at the parser level
  // (wantsText is true for both). This test is a regression smoke for the
  // demotion path — primarily that prompt() does not throw or hang. The
  // wire-format effect of the demotion is asserted in the bridge transport
  // 'both' test, which checks toolEventMode: 'text' is sent.
  expect(segments.some((s) => s.includes("Both demoted tool"))).toBe(true);
});
