import { readFileSync } from "node:fs";
import { copyFile, mkdir, readFile, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

// Core package names, current and renamed. weacpx is being renamed to xacpx
// (see the rename plan); the core root resolves under either name and a
// resolution shim is laid down for BOTH so plugins built against either
// `weacpx/plugin-api` or `xacpx/plugin-api` keep resolving across the rename —
// no plugin reinstall required.
const CORE_PACKAGE_NAMES = ["weacpx", "xacpx"] as const;

/**
 * Resolve the core package root directory from the running script's location.
 * Walks up the directory tree looking for the `package.json` whose name is one
 * of {@link CORE_PACKAGE_NAMES} (the bundle is emitted to `<root>/dist`, but
 * this tolerates deeper or monorepo nesting too). Returns null when the root
 * cannot be determined.
 */
function resolveCoreRoot(): string | null {
  try {
    let dir = dirname(fileURLToPath(import.meta.url));
    // Bounded walk-up: stops at the filesystem root or after a generous depth.
    for (let depth = 0; depth < 12; depth++) {
      try {
        const pkg = JSON.parse(readFileSync(join(dir, "package.json"), "utf-8")) as { name?: string };
        if (pkg.name && (CORE_PACKAGE_NAMES as readonly string[]).includes(pkg.name)) return dir;
      } catch {
        // no/unreadable package.json at this level — keep walking up
      }
      const parent = dirname(dir);
      if (parent === dir) break; // reached the filesystem root
      dir = parent;
    }
    return null;
  } catch {
    return null;
  }
}

/**
 * Ensure channel plugins can resolve `import ... from "weacpx/plugin-api"` (or
 * `"xacpx/plugin-api"` after the rename) at runtime. Plugins are built with the
 * core package externalized, so the import resolves from the plugin home's
 * `node_modules` tree.
 *
 * A shim at `pluginHome/node_modules/<core>/` with a synthetic `package.json`
 * makes the `<core>` package resolvable. The runtime `plugin-api.js` bundle is
 * copied into the shim so `exports["./plugin-api"]` can use a relative path
 * (required by Node.js ESM resolution — absolute paths and `file://` URLs are
 * not valid in the `exports` map).
 *
 * A shim is written for BOTH {@link CORE_PACKAGE_NAMES} (`weacpx` and `xacpx`),
 * each pointing at the same bundle, so plugins built against either specifier
 * resolve regardless of which core is installed — the weacpx→xacpx rename then
 * needs no plugin reinstall. The copies are refreshed on every
 * `ensurePluginHome` call so they stay in sync with the running core version.
 */
async function ensureCoreResolution(pluginHome: string): Promise<void> {
  const root = resolveCoreRoot();
  if (!root) return;
  const srcJs = join(root, "dist", "plugin-api.js");
  for (const name of CORE_PACKAGE_NAMES) {
    const targetDir = join(pluginHome, "node_modules", name);
    const dstJs = join(targetDir, "plugin-api.js");
    await mkdir(targetDir, { recursive: true });
    // Copy the runtime bundle FIRST. If it is missing (e.g. the core was not
    // built) or the copy fails, skip writing this shim's manifest — a
    // package.json whose `./plugin-api` export points at a nonexistent file
    // would only fail later with a more confusing "Cannot find module
    // './plugin-api.js'". A loud warning beats a silently broken shim.
    try {
      await copyFile(srcJs, dstJs);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.warn(
        `weacpx: skipped plugin-api resolution shim for "${name}" — could not copy ${srcJs} (${message}). ` +
          `Channel plugins importing "${name}/plugin-api" at runtime may fail to load.`,
      );
      continue;
    }
    await writeFile(
      join(targetDir, "package.json"),
      JSON.stringify({
        name,
        type: "module",
        exports: {
          "./plugin-api": "./plugin-api.js",
        },
      }, null, 2) + "\n",
    );
  }
}

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
  await ensureCoreResolution(pluginHome);
}
