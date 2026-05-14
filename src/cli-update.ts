import { spawn } from "node:child_process";
import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import type { AppConfig, PluginConfig } from "./config/types.js";
import { resolvePluginHome, ensurePluginHome } from "./plugins/plugin-home.js";
import { updatePluginPackage } from "./plugins/package-manager.js";
import { importPluginFromHome } from "./plugins/plugin-loader.js";
import { validateWeacpxPlugin } from "./plugins/validate-plugin.js";

export interface UpdateCliDeps {
  loadConfig: () => Promise<AppConfig>;
  saveConfig: (config: AppConfig) => Promise<void>;
  readCurrentVersion: () => string;
  print: (line: string) => void;
  isInteractive: () => boolean;
  promptText: (message: string) => Promise<string>;
  packageName?: string;
  pluginHome?: string;
  getLatestVersion?: (packageName: string) => Promise<string | null>;
  updateSelf?: (packageName: string) => Promise<void>;
  updatePlugin?: (input: { packageName: string; version?: string }) => Promise<void>;
  validatePlugin?: (packageName: string, pluginHome: string) => Promise<void>;
}

interface UpdateTarget {
  kind: "self" | "plugin";
  name: string;
  currentVersion?: string;
  latestVersion?: string | null;
  pinned?: boolean;
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
  const targets: UpdateTarget[] = [
    {
      kind: "self",
      name: packageName,
      currentVersion: deps.readCurrentVersion(),
      latestVersion: await latestOf(packageName),
    },
  ];
  for (const plugin of config.plugins ?? []) {
    targets.push({
      kind: "plugin",
      name: plugin.name,
      currentVersion: plugin.version,
      pinned: Boolean(plugin.version),
      latestVersion: await latestOf(plugin.name),
    });
  }

  deps.print("可更新项：");
  for (let index = 0; index < targets.length; index += 1) {
    const target = targets[index]!;
    deps.print(`${index + 1}. ${formatTarget(target)}`);
  }

  const unavailable = targets.filter((target) => !target.latestVersion || (target.kind === "plugin" && !target.pinned));
  if (all && unavailable.length > 0) {
    deps.print(`以下项目无法检查最新版本，已取消更新：${unavailable.map((target) => target.name).join(", ")}`);
    return 1;
  }
  const candidates = targets.filter((target) => target.latestVersion && (target.kind !== "plugin" || target.pinned) && target.currentVersion !== target.latestVersion);
  const selected = await selectTargets(targets, candidates, { all, explicitTarget: explicitTargets[0], deps });
  if (!selected.ok) {
    deps.print(selected.message);
    return selected.exitCode;
  }
  if (selected.targets.length === 0) {
    deps.print("没有需要更新的项目。");
    return 0;
  }

  const selfUpdater = deps.updateSelf ?? defaultUpdateSelf;
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
        if (!all && !explicitTargets[0]) {
          if (!deps.isInteractive()) {
            deps.print("更新 weacpx 本体需要确认；非交互模式请使用 `weacpx update --all` 或 `weacpx update weacpx`。");
            return 1;
          }
          const answer = (await deps.promptText("确认更新 weacpx 本体？[y/N] ")).trim().toLowerCase();
          if (answer !== "y" && answer !== "yes") {
            deps.print("已取消更新 weacpx 本体。");
            continue;
          }
        }
        await selfUpdater(target.name);
        deps.print(`weacpx 已更新：${target.latestVersion ?? "latest"}`);
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
            deps.print(`回滚 ${target.name} 到 ${previousVersion} 失败：${rollbackError instanceof Error ? rollbackError.message : String(rollbackError)}`);
          }
        }
        throw validationError;
      }
      if (!existing) throw new Error(`配置中没有找到插件 ${target.name}`);
      if (existing && target.latestVersion) existing.version = target.latestVersion;
      deps.print(`插件 ${target.name} 已更新：${target.latestVersion ?? "latest"}`);
    } catch (error) {
      deps.print(`${target.name} 更新失败：${error instanceof Error ? error.message : String(error)}`);
      return 1;
    }
  }

  if (selected.targets.some((target) => target.kind === "plugin")) {
    config.plugins = updatedPlugins;
    await deps.saveConfig(config);
  }
  return 0;
}

function formatTarget(target: UpdateTarget): string {
  const current = target.currentVersion ?? "未锁定";
  const latest = target.latestVersion ?? "无法检查";
  const label = target.kind === "self" ? "weacpx" : `插件 ${target.name}`;
  return `${label} (${current} -> ${latest})`;
}

async function selectTargets(
  targets: UpdateTarget[],
  candidates: UpdateTarget[],
  input: { all: boolean; explicitTarget?: string; deps: Pick<UpdateCliDeps, "isInteractive" | "promptText"> },
): Promise<{ ok: true; targets: UpdateTarget[] } | { ok: false; message: string; exitCode: number }> {
  if (input.explicitTarget) {
    const target = targets.find((entry) => entry.name === input.explicitTarget || (input.explicitTarget === "weacpx" && entry.kind === "self"));
    if (!target) return { ok: false, message: `没有找到更新项：${input.explicitTarget}`, exitCode: 1 };
    if (!target.latestVersion) return { ok: false, message: `${target.name} 无法检查最新版本，已跳过。`, exitCode: 1 };
    if (target.kind === "plugin" && !target.pinned) return { ok: false, message: `${target.name} 未记录当前版本；请先使用 \`weacpx plugin update ${target.name}\` 或显式选择版本。`, exitCode: 1 };
    if (target.currentVersion === target.latestVersion) return { ok: true, targets: [] };
    return { ok: true, targets: [target] };
  }

  if (input.all || targets.length === 1) return { ok: true, targets: candidates };

  if (!input.deps.isInteractive()) {
    return { ok: false, message: "检测到已安装插件；非交互模式请使用 `weacpx update --all` 或 `weacpx update <name>`。", exitCode: 1 };
  }

  const answer = (await input.deps.promptText("请选择要更新的项目（数字，逗号分隔，a=全部，回车取消）：")).trim().toLowerCase();
  if (!answer) return { ok: true, targets: [] };
  if (answer === "a" || answer === "all") return { ok: true, targets: candidates };

  const selected: UpdateTarget[] = [];
  for (const part of answer.split(",")) {
    const index = Number.parseInt(part.trim(), 10);
    if (!Number.isFinite(index) || index < 1 || index > targets.length) {
      return { ok: false, message: `无效选择：${part.trim()}`, exitCode: 1 };
    }
    const target = targets[index - 1]!;
    if (!target.latestVersion) return { ok: false, message: `${target.name} 无法检查最新版本，已跳过。`, exitCode: 1 };
    if (target.kind === "plugin" && !target.pinned) return { ok: false, message: `${target.name} 未记录当前版本；请先使用 \`weacpx plugin update ${target.name}\` 或显式选择版本。`, exitCode: 1 };
    if (target.currentVersion === target.latestVersion) continue;
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
  const manager = process.env.WEACPX_PACKAGE_MANAGER?.trim().toLowerCase() === "bun" ? "bun" : "npm";
  if (manager === "bun") {
    await runInherit("bun", ["add", "-g", packageName]);
    return;
  }
  await runInherit("npm", ["install", "-g", packageName]);
}

async function runCapture(command: string, args: string[]): Promise<{ code: number; stdout: string; stderr: string }> {
  return await new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: ["ignore", "pipe", "pipe"] });
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
    const child = spawn(command, args, { stdio: "inherit" });
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
  return "weacpx";
}

async function validatePluginDefault(packageName: string, pluginHome: string): Promise<void> {
  const moduleValue = await importPluginFromHome(packageName, pluginHome);
  validateWeacpxPlugin(moduleValue, packageName);
}
