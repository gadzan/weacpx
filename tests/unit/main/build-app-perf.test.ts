import { expect, test } from "bun:test";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { buildApp, resolveRuntimePaths } from "../../../src/main";

const BASE_CONFIG = {
  transport: { type: "acpx-cli", permissionMode: "approve-all", nonInteractivePermissions: "deny" },
  agents: {},
  workspaces: {},
};

async function setupTmp(perfEnabled: boolean) {
  const dir = await mkdtemp(join(tmpdir(), "weacpx-buildapp-"));
  const cfg = join(dir, "config.json");
  await writeFile(cfg, JSON.stringify({
    ...BASE_CONFIG,
    logging: {
      level: "info",
      maxSizeBytes: 1024,
      maxFiles: 3,
      retentionDays: 7,
      perf: { enabled: perfEnabled, maxSizeBytes: 1_000_000, maxFiles: 3, retentionDays: 7 },
    },
  }));
  return { dir, cfg };
}

test("buildApp creates a noop perfTracer when disabled (default)", async () => {
  const { dir, cfg } = await setupTmp(false);
  const prevCfg = process.env.WEACPX_CONFIG;
  const prevState = process.env.WEACPX_STATE;
  process.env.WEACPX_CONFIG = cfg;
  process.env.WEACPX_STATE = join(dir, "state.json");
  try {
    const paths = resolveRuntimePaths();
    const runtime = await buildApp(paths);
    expect(runtime.perfTracer).toBeDefined();
    await runtime.perfTracer.wrapTurn({ chatKey: "k", kind: "prompt" }, async (span) => {
      span.mark("turn.received");
    });
    await runtime.dispose();
    await expect(readFile(join(dir, "runtime", "perf.log"), "utf8")).rejects.toThrow();
  } finally {
    process.env.WEACPX_CONFIG = prevCfg;
    process.env.WEACPX_STATE = prevState;
    await rm(dir, { recursive: true, force: true });
  }
});

test("buildApp creates a real perfTracer when enabled and flushes on dispose", async () => {
  const { dir, cfg } = await setupTmp(true);
  const prevCfg = process.env.WEACPX_CONFIG;
  const prevState = process.env.WEACPX_STATE;
  process.env.WEACPX_CONFIG = cfg;
  process.env.WEACPX_STATE = join(dir, "state.json");
  try {
    const paths = resolveRuntimePaths();
    const runtime = await buildApp(paths);
    await runtime.perfTracer.wrapTurn({ chatKey: "k", kind: "prompt" }, async (span) => {
      span.mark("turn.received");
    });
    await runtime.dispose();

    const content = await readFile(join(dir, "runtime", "perf.log"), "utf8");
    expect(content).toContain("turn.received");
    expect(content).toContain("turn.done");
  } finally {
    process.env.WEACPX_CONFIG = prevCfg;
    process.env.WEACPX_STATE = prevState;
    await rm(dir, { recursive: true, force: true });
  }
});
