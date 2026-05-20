import { mkdir, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";

/**
 * Treat the literal strings "undefined" / "null" (case-insensitive) as missing
 * values. They show up when a caller stringifies a JS undefined/null into an
 * env var or argument — without this guard, paths like `undefined/.weacpx/...`
 * get materialized inside the current working directory.
 */
function coerceMissing(value: string | undefined): string | undefined {
  if (value === undefined) return undefined;
  const trimmed = value.trim();
  if (!trimmed) return undefined;
  const lower = trimmed.toLowerCase();
  if (lower === "undefined" || lower === "null") return undefined;
  return trimmed;
}

export function resolvePluginHome(input: { home?: string; pluginHome?: string } = {}): string {
  const explicit = coerceMissing(input.pluginHome);
  if (explicit) return explicit;
  const envOverride = coerceMissing(process.env.WEACPX_PLUGIN_HOME);
  if (envOverride) return envOverride;
  const home = coerceMissing(input.home) ?? coerceMissing(process.env.HOME) ?? homedir();
  return join(home, ".weacpx", "plugins");
}

export async function ensurePluginHome(pluginHome: string): Promise<void> {
  await mkdir(pluginHome, { recursive: true, mode: 0o700 });
  await writeFile(
    join(pluginHome, "package.json"),
    JSON.stringify({ private: true, type: "module" }, null, 2) + "\n",
    { flag: "wx" },
  ).catch((error: NodeJS.ErrnoException) => {
    if (error.code !== "EEXIST") throw error;
  });
}
