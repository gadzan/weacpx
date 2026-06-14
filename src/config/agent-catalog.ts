import { existsSync } from "node:fs";
import { delimiter, join } from "node:path";

import type { AppConfig } from "./types";
import { listAgentTemplates } from "./agent-templates";

export interface AgentCatalogEntry {
  driver: string;
  configured: boolean;
  installed: "builtin" | "yes" | "unknown";
}

// codex/claude are npm-published ACP adapters auto-fetched via npx — usable with
// nothing pre-installed. acpx's BUILT_IN_AGENT_PACKAGES is not importable here
// (acpx is a child-process binary), so this small set is maintained by hand.
const BUILTIN_DRIVERS = new Set(["codex", "claude"]);

// Best-effort driver -> CLI binary. Default: the binary equals the driver name.
// Only exceptions need an entry. This is advisory; a miss yields "unknown", never
// a hard block (the agent may be installed under a name we can't predict).
const DRIVER_BINARIES: Record<string, string> = {
  cursor: "cursor-agent",
};

/** True if `binary` is found in any PATH directory (no extension assumptions on POSIX). */
export function isBinaryOnPath(binary: string): boolean {
  const path = process.env.PATH ?? "";
  const exts = process.platform === "win32" ? ["", ".exe", ".cmd", ".bat"] : [""];
  for (const dir of path.split(delimiter)) {
    if (!dir) continue;
    for (const ext of exts) {
      try {
        if (existsSync(join(dir, binary + ext))) return true;
      } catch {
        // ignore unreadable PATH entries
      }
    }
  }
  return false;
}

/**
 * Catalog of every acpx driver xacpx knows (from `listAgentTemplates()`), each
 * tagged with whether it's already configured and a best-effort install hint.
 * `probe` is injectable for tests; defaults to a real PATH lookup.
 */
export function listAgentCatalog(
  config: AppConfig,
  probe: (binary: string) => boolean = isBinaryOnPath,
): AgentCatalogEntry[] {
  const agents = config.agents ?? {};
  const driverConfigured = (driver: string): boolean =>
    Object.entries(agents).some(([name, a]) => name === driver || a.driver === driver);

  return listAgentTemplates().map((driver) => {
    let installed: AgentCatalogEntry["installed"];
    if (BUILTIN_DRIVERS.has(driver)) {
      installed = "builtin";
    } else {
      const binary = DRIVER_BINARIES[driver] ?? driver;
      installed = probe(binary) ? "yes" : "unknown";
    }
    return { driver, configured: driverConfigured(driver), installed };
  });
}
