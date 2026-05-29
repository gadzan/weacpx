import { mkdir, readFile, writeFile } from "node:fs/promises";
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

/**
 * Collapse duplicate keys in the plugin home `package.json`.
 *
 * A package manager can leave the same dependency under two keys/spec-forms —
 * notably `bun add` on Windows recording a package once as an npm version and
 * once as an absolute local path — which is invalid JSON (duplicate key) and
 * corrupts `bun.lock` (`InvalidPackageKey: failed to parse lockfile`). Node's
 * `JSON.parse` tolerates duplicate keys and keeps the *last* value, so a
 * parse → stringify round-trip physically removes the duplicates.
 *
 * Returns `true` when the file was rewritten (i.e. it had been changed),
 * `false` when there was nothing to fix (clean, missing, or unparseable for
 * some other reason — in which case the file is left untouched).
 */
export async function normalizePluginHomeManifest(pluginHome: string): Promise<boolean> {
  const manifestPath = join(pluginHome, "package.json");
  let raw: string;
  try {
    raw = await readFile(manifestPath, "utf8");
  } catch {
    return false;
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    // Unparseable for a reason other than duplicate keys (which JSON.parse
    // accepts). Don't clobber a manifest we can't safely understand.
    return false;
  }
  const normalized = JSON.stringify(parsed, null, 2) + "\n";
  if (normalized === raw) return false;
  await writeFile(manifestPath, normalized, { mode: 0o600 });
  return true;
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
