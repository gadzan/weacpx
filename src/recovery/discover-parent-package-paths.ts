import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import { access } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join } from "node:path";

const require = createRequire(import.meta.url);

export type PackageManager = "npm" | "bun" | "pnpm" | "yarn";

export interface DiscoveredParentPath {
  /** Absolute directory containing the parent package's package.json. */
  path: string;
  /** Which package manager owns this directory — determines which CLI to install with. */
  manager: PackageManager;
}

export interface DiscoverDeps {
  env?: NodeJS.ProcessEnv;
  home?: string;
  platform?: NodeJS.Platform;
  /**
   * Working directory used as the anchor for `require.resolve` style lookups.
   * In production this is typically the bridge / acpx cwd, not the daemon's cwd.
   * Defaults to `process.cwd()` which is usually wrong for daemonized use.
   */
  cwd?: string;
  fsExists?: (path: string) => Promise<boolean>;
  /**
   * Resolve `<name>/package.json` via Node.js resolution, anchored on the provided cwd.
   * Returns the parent package dir (containing package.json) or null.
   */
  resolveFromCwd?: (parentName: string, cwd: string) => string | null;
  /**
   * Query a package manager root. Short timeout; null if the CLI is unavailable.
   */
  queryPackageManagerRoot?: (tool: "npm" | "pnpm" | "yarn") => Promise<string | null>;
}

/**
 * Strip platform / arch / libc suffixes from an npm optional platform package name.
 * Examples:
 *   "opencode-windows-x64" → "opencode"
 *   "@scope/pkg-linux-arm64-musl" → "@scope/pkg"
 *   "esbuild-darwin-x64" → "esbuild"
 *   "@next/swc-win32-x64-msvc" → "@next/swc"
 *   "@rollup/rollup-linux-x64-gnu" → "@rollup/rollup"
 */
export function deriveParentPackageName(platformPackage: string): string {
  return platformPackage.replace(
    /-(?:linux|darwin|win32|windows|freebsd|openbsd|sunos|aix)(?:-(?:x64|arm64|ia32|arm|ppc64|s390x))?(?:-(?:baseline|musl|gnu|gnueabihf|musleabihf|msvc))?$/,
    "",
  );
}

/**
 * Enumerate directories where the parent package might be installed across
 * common package managers: npm (global), Bun (global), pnpm (global), Yarn (global),
 * plus the local Node resolution tree. Each entry is tagged with its owning
 * package manager so the installer can dispatch to the correct CLI — running
 * `npm install` inside a Bun or pnpm tree would corrupt the managed store.
 *
 * Every returned path is guaranteed to exist and contain a package.json.
 * Duplicates and non-existent paths are filtered out.
 */
export async function discoverParentPackagePaths(
  platformPackage: string,
  seedPath: string | null,
  deps: DiscoverDeps = {},
): Promise<DiscoveredParentPath[]> {
  const env = deps.env ?? process.env;
  const home = deps.home ?? homedir();
  const cwd = deps.cwd ?? process.cwd();
  const fsExists = deps.fsExists ?? defaultFsExists;
  const resolveFromCwd = deps.resolveFromCwd ?? defaultResolveFromCwd;
  const queryRoot = deps.queryPackageManagerRoot ?? defaultQueryPackageManagerRoot;

  const parentName = deriveParentPackageName(platformPackage);
  const rawCandidates: DiscoveredParentPath[] = [];

  const bunGlobalRoot = env.BUN_INSTALL
    ? join(env.BUN_INSTALL, "install", "global", "node_modules")
    : join(home, ".bun", "install", "global", "node_modules");

  // CLI-reported roots — used both as a candidate source AND as a prefix to classify
  // the seed and cwd-resolved paths below.
  const [npmRoot, pnpmRoot, yarnRoot] = await Promise.all([
    queryRoot("npm"),
    queryRoot("pnpm"),
    queryRoot("yarn"),
  ]);

  const classify = (p: string): PackageManager => {
    if (isUnder(p, bunGlobalRoot)) return "bun";
    if (pnpmRoot && isUnder(p, pnpmRoot)) return "pnpm";
    if (yarnRoot && isUnder(p, yarnRoot)) return "yarn";
    return "npm";
  };

  if (seedPath) {
    rawCandidates.push({ path: seedPath, manager: classify(seedPath) });
  }

  // Node.js resolution (anchored on cwd)
  for (const name of [parentName, platformPackage]) {
    const resolved = resolveFromCwd(name, cwd);
    if (resolved) rawCandidates.push({ path: resolved, manager: classify(resolved) });
  }

  // Bun global — always manager=bun, even on Windows (Bun on Windows uses ~/.bun too)
  rawCandidates.push({ path: join(bunGlobalRoot, parentName), manager: "bun" });

  // npm/pnpm/yarn global trees
  if (npmRoot) rawCandidates.push({ path: join(npmRoot, parentName), manager: "npm" });
  if (pnpmRoot) rawCandidates.push({ path: join(pnpmRoot, parentName), manager: "pnpm" });
  if (yarnRoot) rawCandidates.push({ path: join(yarnRoot, parentName), manager: "yarn" });

  // Dedupe by path (first wins — preserves the seed's classification if it also shows up via a global root)
  const seen = new Set<string>();
  const verified: DiscoveredParentPath[] = [];
  for (const candidate of rawCandidates) {
    if (seen.has(candidate.path)) continue;
    seen.add(candidate.path);
    if (await fsExists(join(candidate.path, "package.json"))) {
      verified.push(candidate);
    }
  }
  return verified;
}

function isUnder(child: string, parent: string): boolean {
  // Normalize trailing separators so "/a" and "/a/" both match "/a/b".
  const c = child.replace(/[\\/]+$/, "");
  const p = parent.replace(/[\\/]+$/, "");
  return c === p || c.startsWith(p + "/") || c.startsWith(p + "\\");
}

async function defaultFsExists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

function defaultResolveFromCwd(name: string, cwd: string): string | null {
  try {
    const pkgJson = require.resolve(`${name}/package.json`, {
      paths: [cwd, ...(require.resolve.paths(name) ?? [])],
    });
    return dirname(pkgJson);
  } catch {
    return null;
  }
}

async function defaultQueryPackageManagerRoot(
  tool: "npm" | "pnpm" | "yarn",
): Promise<string | null> {
  const spec = tool === "yarn"
    ? { cmd: "yarn", args: ["global", "dir"], postfix: "node_modules" }
    : { cmd: tool, args: ["root", "-g"], postfix: null };
  return await new Promise<string | null>((resolve) => {
    let settled = false;
    const done = (value: string | null) => {
      if (settled) return;
      settled = true;
      resolve(value);
    };
    let child;
    try {
      child = spawn(spec.cmd, spec.args, {
        stdio: ["ignore", "pipe", "pipe"],
        shell: process.platform === "win32",
      });
    } catch {
      done(null);
      return;
    }
    let stdout = "";
    const timer = setTimeout(() => {
      try { child.kill(); } catch { /* noop */ }
      done(null);
    }, 2000);
    timer.unref?.();
    child.stdout.on("data", (chunk) => { stdout += String(chunk); });
    child.on("error", () => { clearTimeout(timer); done(null); });
    child.on("close", (code) => {
      clearTimeout(timer);
      if (code !== 0) return done(null);
      const trimmed = stdout.trim().split(/\r?\n/).pop()?.trim() ?? "";
      if (!trimmed) return done(null);
      done(spec.postfix ? join(trimmed, spec.postfix) : trimmed);
    });
  });
}
