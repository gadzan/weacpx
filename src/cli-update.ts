import { spawn } from "node:child_process";
import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import type { AppConfig, PluginConfig } from "./config/types.js";
import { resolvePluginHome, ensurePluginHome } from "./plugins/plugin-home.js";
import { updatePluginPackage } from "./plugins/package-manager.js";
import { importPluginFromHome } from "./plugins/plugin-loader.js";
import { validateWeacpxPlugin } from "./plugins/validate-plugin.js";
import { coreEnv } from "./runtime/core-env.js";
import { t } from "./i18n";

// Rename forward-compat: weacpx is being renamed to xacpx (`x → acp → x`) at
// 0.8.0. This descriptor lets a `weacpx update` running on 0.7.x cross over to
// the renamed package on its own. It stays DORMANT until xacpx is actually
// published at >= minVersion — until then `npm view xacpx version` returns
// nothing and self-update behaves exactly as before. The `from` guard means
// the code is inert once it ships inside xacpx itself (current package is no
// longer "weacpx"), so the renamed package never tries to migrate to itself.
const SUCCESSOR = { from: "weacpx", package: "xacpx", minVersion: "0.8.0" } as const;

export interface UpdateCliDeps {
  loadConfig: () => Promise<AppConfig>;
  /** Persists only the plugins[] subtree — never the whole parsed config. */
  savePlugins: (plugins: PluginConfig[]) => Promise<void>;
  readCurrentVersion: () => string;
  print: (line: string) => void;
  isInteractive: () => boolean;
  promptText: (message: string) => Promise<string>;
  packageName?: string;
  pluginHome?: string;
  getLatestVersion?: (packageName: string) => Promise<string | null>;
  updateSelf?: (packageName: string) => Promise<void>;
  // Cross-package self-migration for the weacpx→xacpx rename: install the
  // successor, then remove the old package. Injectable for tests.
  migrateSelf?: (input: { from: string; to: string; toVersion?: string }) => Promise<void>;
  // Stop a running daemon before a rename migration so no old-named daemon is
  // left holding the channel connection. No-op by default; wired in cli.ts.
  stopDaemon?: () => Promise<void>;
  updatePlugin?: (input: { packageName: string; version?: string }) => Promise<void>;
  validatePlugin?: (packageName: string, pluginHome: string) => Promise<void>;
}

interface UpdateTarget {
  kind: "self" | "plugin";
  name: string;
  currentVersion?: string;
  latestVersion?: string | null;
  // When set on the self target, this update is a rename migration to the named
  // successor package (e.g. "xacpx") rather than an in-place version bump.
  successorPackage?: string;
}

export async function handleUpdateCli(args: string[], deps: UpdateCliDeps): Promise<number | null> {
  let all = false;
  const explicitTargets: string[] = [];
  for (const arg of args) {
    if (arg === "--all") all = true;
    else explicitTargets.push(arg);
  }
  if (all && explicitTargets.length > 0) return null;
  if (explicitTargets.length > 1) return null;

  const config = await deps.loadConfig();
  const packageName = deps.packageName ?? await readPackageName();
  const latestOf = deps.getLatestVersion ?? getLatestNpmVersion;
  const successor = await resolveSuccessor(packageName, latestOf);
  const selfTarget: UpdateTarget = successor
    ? {
        kind: "self",
        name: packageName,
        currentVersion: deps.readCurrentVersion(),
        latestVersion: successor.version,
        successorPackage: successor.package,
      }
    : {
        kind: "self",
        name: packageName,
        currentVersion: deps.readCurrentVersion(),
        latestVersion: await latestOf(packageName),
      };
  const targets: UpdateTarget[] = [selfTarget];
  for (const plugin of config.plugins ?? []) {
    targets.push({
      kind: "plugin",
      name: plugin.name,
      currentVersion: plugin.version,
      latestVersion: await latestOf(plugin.name),
    });
  }

  deps.print(t().cliUpdate.updatesAvailable);
  for (let index = 0; index < targets.length; index += 1) {
    const target = targets[index]!;
    deps.print(`${index + 1}. ${formatTarget(target)}`);
  }

  const unavailable = targets.filter((target) => !target.latestVersion);
  if (all && unavailable.length > 0) {
    deps.print(t().cliUpdate.unavailableAborted(unavailable.map((target) => target.name).join(", ")));
    return 1;
  }
  // An unpinned plugin (no recorded version) has currentVersion === undefined,
  // so it is always considered a candidate as long as its latest version is
  // known — `update` installs latest and pins the result, matching the
  // behavior of `xacpx plugin update`.
  const candidates = targets.filter((target) => target.latestVersion && (target.successorPackage ? true : target.currentVersion !== target.latestVersion));
  const selected = await selectTargets(targets, candidates, { all, explicitTarget: explicitTargets[0], deps });
  if (!selected.ok) {
    deps.print(selected.message);
    return selected.exitCode;
  }
  if (selected.targets.length === 0) {
    deps.print(t().cliUpdate.nothingToUpdate);
    return 0;
  }

  const selfUpdater = deps.updateSelf ?? defaultUpdateSelf;
  const selfMigrator = deps.migrateSelf ?? defaultMigrateSelf;
  const stopDaemon = deps.stopDaemon ?? (async () => {});
  const pluginHome = deps.pluginHome ?? resolvePluginHome();
  const pluginUpdater = deps.updatePlugin ?? (async (input) => {
    await ensurePluginHome(pluginHome);
    await updatePluginPackage({ ...input, pluginHome });
  });
  const validatePlugin = deps.validatePlugin ?? validatePluginDefault;

  const updatedPlugins: PluginConfig[] = [...(config.plugins ?? [])];
  for (const target of selected.targets) {
    try {
      if (target.kind === "self") {
        const successorPackage = target.successorPackage;
        if (!all && !explicitTargets[0]) {
          if (!deps.isInteractive()) {
            deps.print(successorPackage
              ? t().cliUpdate.renameNeedsConfirmNonInteractive(successorPackage)
              : t().cliUpdate.selfUpdateNeedsConfirmNonInteractive(target.name));
            return 1;
          }
          const question = successorPackage
            ? t().cliUpdate.renameConfirmPrompt(successorPackage)
            : t().cliUpdate.selfUpdateConfirmPrompt(target.name);
          const answer = (await deps.promptText(question)).trim().toLowerCase();
          if (answer !== "y" && answer !== "yes") {
            deps.print(successorPackage ? t().cliUpdate.renameCancelled(successorPackage) : t().cliUpdate.selfUpdateCancelled(target.name));
            continue;
          }
        }
        if (successorPackage) {
          // Stop any running daemon first, then install the successor and remove
          // the old package (install-then-remove, so a failed install never
          // leaves the user with no working CLI).
          await stopDaemon();
          await selfMigrator({ from: target.name, to: successorPackage, toVersion: target.latestVersion ?? undefined });
          deps.print(t().cliUpdate.renameMigrated(successorPackage, target.latestVersion ?? "latest"));
          continue;
        }
        await selfUpdater(target.name);
        deps.print(t().cliUpdate.selfUpdated(target.name, target.latestVersion ?? "latest"));
        continue;
      }

      const existing = updatedPlugins.find((plugin) => plugin.name === target.name);
      const previousVersion = existing?.version;
      const updateInput = target.latestVersion ? { packageName: target.name, version: target.latestVersion } : { packageName: target.name };
      await pluginUpdater(updateInput);
      try {
        await validatePlugin(target.name, pluginHome);
      } catch (validationError) {
        if (previousVersion) {
          try {
            await pluginUpdater({ packageName: target.name, version: previousVersion });
          } catch (rollbackError) {
            deps.print(t().cliUpdate.pluginRollbackFailed(target.name, previousVersion, rollbackError instanceof Error ? rollbackError.message : String(rollbackError)));
          }
        }
        throw validationError;
      }
      if (!existing) throw new Error(t().cliUpdate.pluginNotInConfig(target.name));
      if (existing && target.latestVersion) existing.version = target.latestVersion;
      deps.print(t().cliUpdate.pluginUpdated(target.name, target.latestVersion ?? "latest"));
    } catch (error) {
      deps.print(t().cliUpdate.updateFailed(target.name, error instanceof Error ? error.message : String(error)));
      return 1;
    }
  }

  if (selected.targets.some((target) => target.kind === "plugin")) {
    config.plugins = updatedPlugins;
    await deps.savePlugins(updatedPlugins);
  }
  return 0;
}

function formatTarget(target: UpdateTarget): string {
  const current = target.currentVersion ?? t().cliUpdate.versionUnlocked;
  const latest = target.latestVersion ?? t().cliUpdate.versionUnknown;
  if (target.kind === "self") {
    return target.successorPackage
      ? t().cliUpdate.formatRename(target.successorPackage, current, latest)
      : t().cliUpdate.formatSelf(target.name, current, latest);
  }
  return t().cliUpdate.formatPlugin(target.name, current, latest);
}

async function selectTargets(
  targets: UpdateTarget[],
  candidates: UpdateTarget[],
  input: { all: boolean; explicitTarget?: string; deps: Pick<UpdateCliDeps, "isInteractive" | "promptText"> },
): Promise<{ ok: true; targets: UpdateTarget[] } | { ok: false; message: string; exitCode: number }> {
  if (input.explicitTarget) {
    const target = targets.find((entry) => entry.name === input.explicitTarget
      || (entry.kind === "self" && (input.explicitTarget === "weacpx" || input.explicitTarget === entry.successorPackage)));
    if (!target) return { ok: false, message: t().cliUpdate.targetNotFound(input.explicitTarget), exitCode: 1 };
    if (!target.latestVersion) return { ok: false, message: t().cliUpdate.targetVersionUnknown(target.name), exitCode: 1 };
    if (!target.successorPackage && target.currentVersion === target.latestVersion) return { ok: true, targets: [] };
    return { ok: true, targets: [target] };
  }

  if (input.all || targets.length === 1) return { ok: true, targets: candidates };

  if (!input.deps.isInteractive()) {
    return { ok: false, message: t().cliUpdate.multiTargetNonInteractive, exitCode: 1 };
  }

  const answer = (await input.deps.promptText(t().cliUpdate.selectionPrompt)).trim().toLowerCase();
  if (!answer) return { ok: true, targets: [] };
  if (answer === "a" || answer === "all") return { ok: true, targets: candidates };

  const selected: UpdateTarget[] = [];
  for (const part of answer.split(",")) {
    const index = Number.parseInt(part.trim(), 10);
    if (!Number.isFinite(index) || index < 1 || index > targets.length) {
      return { ok: false, message: t().cliUpdate.selectionInvalid(part.trim()), exitCode: 1 };
    }
    const target = targets[index - 1]!;
    if (!target.latestVersion) return { ok: false, message: t().cliUpdate.targetVersionUnknown(target.name), exitCode: 1 };
    if (!target.successorPackage && target.currentVersion === target.latestVersion) continue;
    if (!selected.includes(target)) selected.push(target);
  }
  return { ok: true, targets: selected };
}

export async function getLatestNpmVersion(packageName: string): Promise<string | null> {
  const result = await runCapture("npm", ["view", packageName, "version", "--json"]);
  if (result.code !== 0) return null;
  const raw = result.stdout.trim();
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as unknown;
    return typeof parsed === "string" ? parsed : null;
  } catch {
    return raw.replace(/^"|"$/g, "") || null;
  }
}

async function defaultUpdateSelf(packageName: string): Promise<void> {
  const manager = coreEnv("PACKAGE_MANAGER")?.trim().toLowerCase() === "bun" ? "bun" : "npm";
  if (manager === "bun") {
    await runInherit("bun", ["add", "-g", packageName]);
    return;
  }
  await runInherit("npm", ["install", "-g", packageName]);
}

async function defaultMigrateSelf(input: { from: string; to: string; toVersion?: string }): Promise<void> {
  const manager = coreEnv("PACKAGE_MANAGER")?.trim().toLowerCase() === "bun" ? "bun" : "npm";
  const spec = input.toVersion ? `${input.to}@${input.toVersion}` : `${input.to}@latest`;
  // Install the successor FIRST; only remove the old package once that
  // succeeds. If the install throws, the caller's catch reports it and the
  // uninstall below never runs — the user keeps a working CLI.
  if (manager === "bun") {
    await runInherit("bun", ["add", "-g", spec]);
    await runInherit("bun", ["remove", "-g", input.from]);
    return;
  }
  await runInherit("npm", ["install", "-g", spec]);
  await runInherit("npm", ["uninstall", "-g", input.from]);
}

// Resolve whether `weacpx update` should cross over to the renamed successor
// package. Returns null (no redirect) unless the successor is actually
// published at >= minVersion — which keeps the capability dormant until the
// rename ships. The `from` guard makes this inert once running inside the
// renamed package itself.
async function resolveSuccessor(
  currentPackage: string,
  latestOf: (packageName: string) => Promise<string | null>,
): Promise<{ package: string; version: string } | null> {
  if (currentPackage !== SUCCESSOR.from) return null;
  const version = await latestOf(SUCCESSOR.package);
  if (!version || !meetsMinVersion(version, SUCCESSOR.minVersion)) return null;
  return { package: SUCCESSOR.package, version };
}

// True when `candidate` is >= `min`. Compares the numeric major.minor.patch
// tuple; a prerelease (e.g. "0.8.0-rc.1") ranks below the same release, so a
// staging prerelease does NOT trip the rename for everyone — only a final
// >= minVersion release does.
function meetsMinVersion(candidate: string, min: string): boolean {
  return compareSemver(candidate, min) >= 0;
}

function compareSemver(a: string, b: string): number {
  const parse = (value: string): { nums: number[]; prerelease: boolean } => {
    const match = /^\s*v?(\d+)\.(\d+)\.(\d+)(-[^\s]*)?/.exec(value);
    if (!match) return { nums: [0, 0, 0], prerelease: false };
    return { nums: [Number(match[1]), Number(match[2]), Number(match[3])], prerelease: Boolean(match[4]) };
  };
  const left = parse(a);
  const right = parse(b);
  for (let i = 0; i < 3; i += 1) {
    if (left.nums[i]! !== right.nums[i]!) return left.nums[i]! < right.nums[i]! ? -1 : 1;
  }
  if (left.prerelease === right.prerelease) return 0;
  return left.prerelease ? -1 : 1;
}

// runCapture/runInherit are only ever used to run package managers (npm/bun).
// On Windows those resolve to .cmd shims, which Node refuses to spawn without
// a shell since the batch-file security change (EINVAL), so spawn with
// `shell: true` there — same pattern as src/recovery/auto-install-optional-dep.ts.
// With a shell, args are not re-quoted, but everything passed here is an npm
// package name/spec or a fixed flag (no spaces or shell metacharacters), so
// this is safe. Do NOT reuse these helpers for commands whose args may
// contain spaces (e.g. paths) without adding quoting.
const spawnUsesShell = (): boolean => process.platform === "win32";

async function runCapture(command: string, args: string[]): Promise<{ code: number; stdout: string; stderr: string }> {
  return await new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: ["ignore", "pipe", "pipe"], shell: spawnUsesShell() });
    let stdout = "";
    let stderr = "";
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk) => { stdout += chunk; });
    child.stderr.on("data", (chunk) => { stderr += chunk; });
    child.on("error", reject);
    child.on("close", (code) => resolve({ code: code ?? 1, stdout, stderr }));
  });
}

async function runInherit(command: string, args: string[]): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const child = spawn(command, args, { stdio: "inherit", shell: spawnUsesShell() });
    child.on("error", reject);
    child.on("exit", (code) => {
      if (code === 0) resolve();
      else reject(new Error(`${command} ${args.join(" ")} exited with code ${code}`));
    });
  });
}

async function readPackageName(): Promise<string> {
  try {
    const here = dirname(fileURLToPath(import.meta.url));
    for (const candidate of [join(here, "..", "package.json"), join(here, "..", "..", "package.json")]) {
      try {
        const parsed = JSON.parse(await readFile(candidate, "utf8")) as { name?: unknown };
        if (typeof parsed.name === "string" && parsed.name.trim()) return parsed.name.trim();
      } catch {}
    }
  } catch {}
  return "xacpx";
}

async function validatePluginDefault(packageName: string, pluginHome: string): Promise<void> {
  const moduleValue = await importPluginFromHome(packageName, pluginHome);
  validateWeacpxPlugin(moduleValue, packageName);
}
