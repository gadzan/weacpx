import { expect, test } from "bun:test";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { buildApp, resolveRuntimePaths } from "../../src/main";

test("builds the runtime services from config and state paths", async () => {
  const dir = await mkdtemp(join(tmpdir(), "weacpx-app-"));
  const configPath = join(dir, "config.json");
  const statePath = join(dir, "state.json");

  await writeFile(
    configPath,
    JSON.stringify({
      transport: { type: "acpx-cli", command: "acpx" },
      agents: { codex: { driver: "codex" } },
      workspaces: {
        backend: {
          cwd: "/tmp/backend",
          allowed_agents: ["codex"],
        },
      },
    }),
  );

  await expect(buildApp({ configPath, statePath })).resolves.toMatchObject({
    agent: expect.anything(),
    router: expect.anything(),
    sessions: expect.anything(),
    stateStore: expect.anything(),
    configStore: expect.anything(),
  });

  await rm(dir, { recursive: true, force: true });
});

test("creates a default config on first run when the config file is missing", async () => {
  const dir = await mkdtemp(join(tmpdir(), "weacpx-app-"));
  const configPath = join(dir, "config.json");
  const statePath = join(dir, "state.json");

  const runtime = await buildApp(
    { configPath, statePath },
    {
      createBridgeTransport: async () => ({
        ensureSession: async () => {},
        prompt: async () => ({ text: "ok" }),
        cancel: async () => ({ cancelled: true, message: "cancelled" }),
        hasSession: async () => true,
        listSessions: async () => [],
        dispose: async () => {},
      }),
    },
  );

  const saved = JSON.parse(await readFile(configPath, "utf8")) as {
    transport: { type: string; sessionInitTimeoutMs?: number };
    agents: Record<string, { driver: string }>;
    workspaces: Record<string, unknown>;
  };

  expect(saved.transport).toEqual({
    type: "acpx-bridge",
    sessionInitTimeoutMs: 120000,
  });
  expect(saved.agents).toEqual({
    codex: {
      driver: "codex",
    },
    claude: {
      driver: "claude",
    },
  });
  expect(saved.workspaces).toEqual({});

  await runtime.dispose();
  await rm(dir, { recursive: true, force: true });
});

test("prefers the configured acpx command when building the cli transport", async () => {
  const dir = await mkdtemp(join(tmpdir(), "weacpx-app-"));
  const configPath = join(dir, "config.json");
  const statePath = join(dir, "state.json");
  let capturedCommand = "";

  await writeFile(
    configPath,
    JSON.stringify({
      transport: { type: "acpx-cli", command: "/custom/acpx" },
      agents: { codex: { driver: "codex" } },
      workspaces: {
        backend: {
          cwd: "/tmp/backend",
        },
      },
    }),
  );

  const runtime = await buildApp(
    { configPath, statePath },
    {
      createCliTransport: (command) => {
        capturedCommand = command;
        return {
          ensureSession: async () => {},
          prompt: async () => ({ text: "ok" }),
          cancel: async () => ({ cancelled: true, message: "cancelled" }),
          hasSession: async () => true,
          listSessions: async () => [],
        };
      },
    },
  );

  expect(capturedCommand).toBe("/custom/acpx");
  await runtime.dispose();
  await rm(dir, { recursive: true, force: true });
});

test("builds the bridge transport when transport.type is acpx-bridge", async () => {
  const dir = await mkdtemp(join(tmpdir(), "weacpx-app-"));
  const configPath = join(dir, "config.json");
  const statePath = join(dir, "state.json");

  await writeFile(
    configPath,
    JSON.stringify({
      transport: { type: "acpx-bridge", command: "acpx" },
      agents: { codex: { driver: "codex" } },
      workspaces: {
        backend: {
          cwd: "/tmp/backend",
          allowed_agents: ["codex"],
        },
      },
    }),
  );

  const runtime = await buildApp(
    { configPath, statePath },
    {
      createBridgeTransport: async () => ({
        ensureSession: async () => {},
        prompt: async () => ({ text: "ok" }),
        cancel: async () => ({ cancelled: true, message: "cancelled" }),
        hasSession: async () => true,
        listSessions: async () => [],
        dispose: async () => {},
      }),
    },
  );

  expect(runtime.router).toBeDefined();
  await runtime.dispose();
  await rm(dir, { recursive: true, force: true });
});

test("defaults to the bridge transport when transport.type is omitted", async () => {
  const dir = await mkdtemp(join(tmpdir(), "weacpx-app-"));
  const configPath = join(dir, "config.json");
  const statePath = join(dir, "state.json");

  await writeFile(
    configPath,
    JSON.stringify({
      transport: { command: "acpx" },
      agents: { codex: { driver: "codex" } },
      workspaces: {
        backend: {
          cwd: "/tmp/backend",
          allowed_agents: ["codex"],
        },
      },
    }),
  );

  const runtime = await buildApp(
    { configPath, statePath },
    {
      createBridgeTransport: async () => ({
        ensureSession: async () => {},
        prompt: async () => ({ text: "ok" }),
        cancel: async () => ({ cancelled: true, message: "cancelled" }),
        hasSession: async () => true,
        listSessions: async () => [],
        dispose: async () => {},
      }),
    },
  );

  expect(runtime.router).toBeDefined();
  await runtime.dispose();
  await rm(dir, { recursive: true, force: true });
});

test("falls back to the OS home directory when HOME is unset", () => {
  const originalHome = process.env.HOME;
  const originalConfig = process.env.WEACPX_CONFIG;
  const originalState = process.env.WEACPX_STATE;

  delete process.env.HOME;
  delete process.env.WEACPX_CONFIG;
  delete process.env.WEACPX_STATE;

  try {
    const paths = resolveRuntimePaths();

    expect(paths.configPath.endsWith("/.weacpx/config.json")).toBe(true);
    expect(paths.statePath.endsWith("/.weacpx/state.json")).toBe(true);
  } finally {
    process.env.HOME = originalHome;
    process.env.WEACPX_CONFIG = originalConfig;
    process.env.WEACPX_STATE = originalState;
  }
});
