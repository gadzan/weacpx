import { expect, test } from "bun:test";
import { listAgentCatalog } from "../../../src/config/agent-catalog";
import type { AppConfig } from "../../../src/config/types";

function cfg(agents: Record<string, { driver: string }>): AppConfig {
  return { agents, workspaces: {} } as unknown as AppConfig;
}

test("codex and claude are always builtin and configured-aware", () => {
  const cat = listAgentCatalog(cfg({ codex: { driver: "codex" } }), () => false);
  const codex = cat.find((e) => e.driver === "codex")!;
  const claude = cat.find((e) => e.driver === "claude")!;
  expect(codex.installed).toBe("builtin");
  expect(codex.configured).toBe(true);
  expect(claude.installed).toBe("builtin");
  expect(claude.configured).toBe(false);
});

test("non-builtin driver is 'yes' when its binary is on PATH, else 'unknown'", () => {
  const cat = listAgentCatalog(cfg({}), (bin) => bin === "gemini");
  expect(cat.find((e) => e.driver === "gemini")!.installed).toBe("yes");
  expect(cat.find((e) => e.driver === "qwen")!.installed).toBe("unknown");
});

test("cursor probes the cursor-agent binary, not 'cursor'", () => {
  const seen: string[] = [];
  listAgentCatalog(cfg({}), (bin) => { seen.push(bin); return false; });
  expect(seen).toContain("cursor-agent");
  expect(seen).not.toContain("cursor");
});

test("configured is true when a config agent uses the driver under a different name", () => {
  const cat = listAgentCatalog(cfg({ "my-gem": { driver: "gemini" } }), () => false);
  expect(cat.find((e) => e.driver === "gemini")!.configured).toBe(true);
});

test("every entry comes from listAgentTemplates and has the three fields", () => {
  const cat = listAgentCatalog(cfg({}), () => false);
  expect(cat.length).toBeGreaterThanOrEqual(15);
  for (const e of cat) {
    expect(typeof e.driver).toBe("string");
    expect(typeof e.configured).toBe("boolean");
    expect(["builtin", "yes", "unknown"]).toContain(e.installed);
  }
});
