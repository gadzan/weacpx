import { readFile } from "node:fs/promises";
import { isAbsolute, join, resolve } from "node:path";

import type { AppConfig, PluginConfig } from "../config/types.js";
import { ensurePluginHome, resolvePluginHome } from "./plugin-home.js";
import { installPluginPackage, removePluginPackage, updatePluginPackage } from "./package-manager.js";
import { importPluginFromHome } from "./plugin-loader.js";
import { validateWeacpxPlugin } from "./validate-plugin.js";
import { inspectPlugins, type PluginDoctorIssue } from "./plugin-doctor.js";
import { listKnownPlugins } from "./known-plugins.js";

export function looksLikePath(spec: string): boolean {
  return (
    spec === "." ||
    // POSIX-style relative / absolute
    spec.startsWith("./") || spec.startsWith("../") || spec.startsWith("/") ||
    // Windows-style relative / UNC (backslash forms cmd/PowerShell produce)
    spec.startsWith(".\\") || spec.startsWith("..\\") || spec.startsWith("\\") ||
    // Windows drive-absolute, e.g. C:\path or C:/path
    /^[a-zA-Z]:[\\/]/.test(spec) ||
    isAbsolute(spec)
  );
}

async function readDependencyEntries(pluginHome: string): Promise<Record<string, string>> {
  try {
    const raw = await readFile(join(pluginHome, "package.json"), "utf8");
    const parsed = JSON.parse(raw) as { dependencies?: Record<string, unknown> };
    const out: Record<string, string> = {};
    for (const [name, value] of Object.entries(parsed.dependencies ?? {})) {
      if (typeof value === "string") out[name] = value;
    }
    return out;
  } catch {
    return {};
  }
}

async function readDependencyNames(pluginHome: string): Promise<Set<string>> {
  return new Set(Object.keys(await readDependencyEntries(pluginHome)));
}

async function resolveLocalPluginName(installSpec: string, pluginHome: string, namesBeforeInstall: Set<string>): Promise<string> {
  const entriesAfter = await readDependencyEntries(pluginHome);
  // First-install case: pick the new dep that didn't exist before.
  for (const name of Object.keys(entriesAfter)) {
    if (!namesBeforeInstall.has(name)) return name;
  }
  // Reinstall case: match by dep value (path/tarball spec) recorded in pluginHome/package.json.
  for (const [name, value] of Object.entries(entriesAfter)) {
    if (value === installSpec || value.includes(installSpec)) return name;
  }
  // Fallback: try reading package.json from the spec when it's a directory.
  try {
    const raw = await readFile(join(installSpec, "package.json"), "utf8");
    const parsed = JSON.parse(raw) as { name?: unknown };
    if (typeof parsed.name === "string" && parsed.name.trim()) return parsed.name.trim();
  } catch {
    // not a directory or no package.json — fall through
  }
  throw new Error(`无法识别本地插件包名：${installSpec}`);
}

type RestartChoice = "restart" | "no-restart" | "ask";

type DaemonStatusForPluginCli =
  | { state: "stopped"; stale?: boolean }
  | { state: "running"; pid: number }
  | { state: "indeterminate"; pid: number; reason: string };

export interface PluginCliDeps {
  loadConfig: () => Promise<AppConfig>;
  saveConfig: (config: AppConfig) => Promise<void>;
  getDaemonStatus: () => Promise<DaemonStatusForPluginCli>;
  restartDaemon: () => Promise<number>;
  print: (line: string) => void;
  isInteractive: () => boolean;
  promptText: (message: string) => Promise<string>;
  pluginHome?: string;
  installPackage?: (input: { packageName: string; version?: string }) => Promise<void>;
  updatePackage?: (input: { packageName: string; version?: string }) => Promise<void>;
  removePackage?: (packageName: string) => Promise<void>;
  validateInstalledPlugin?: (packageName: string) => Promise<{ name: string; channels: string[] }>;
  inspectPlugins?: (input: { config: AppConfig; pluginHome: string; pluginName?: string }) => Promise<PluginDoctorIssue[]>;
}

export async function handlePluginCli(args: string[], deps: PluginCliDeps): Promise<number | null> {
  const subcommand = args[0];
  switch (subcommand) {
    case "list":
      if (args.length !== 1) return null;
      return await listPlugins(deps);
    case "add":
      if (args.length < 2 || !args[1]) return null;
      return await addPlugin(args[1], args.slice(2), deps);
    case "rm":
    case "remove":
      if (args.length < 2 || !args[1]) return null;
      return await removePlugin(args[1], args.slice(2), deps);
    case "update":
      if (args.length < 2 || !args[1]) return null;
      return await updatePlugins(args.slice(1), deps);
    case "enable":
      if (args.length < 2 || !args[1]) return null;
      return await setPluginEnabled(args[1], true, args.slice(2), deps);
    case "disable":
      if (args.length < 2 || !args[1]) return null;
      return await setPluginEnabled(args[1], false, args.slice(2), deps);
    case "doctor":
      if (args.length > 2) return null;
      return await doctorPlugins(args[1], deps);
    case "known":
      return await knownPlugins(args.slice(1), deps);
    default:
      return null;
  }
}

function parseRestartAndVersionFlags(args: string[]): { ok: true; rest: string[]; restart: RestartChoice; version?: string } | { ok: false; message: string } {
  let restart = false;
  let noRestart = false;
  let version: string | undefined;
  const rest: string[] = [];
  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i];
    if (arg === "--restart") restart = true;
    else if (arg === "--no-restart") noRestart = true;
    else if (arg === "--version") {
      const value = args[i + 1];
      if (!value || value.startsWith("--")) return { ok: false, message: "--version requires a value" };
      version = value;
      i += 1;
    } else if (arg !== undefined) rest.push(arg);
  }
  if (restart && noRestart) return { ok: false, message: "--restart and --no-restart cannot be used together" };
  return { ok: true, rest, restart: restart ? "restart" : noRestart ? "no-restart" : "ask", ...(version ? { version } : {}) };
}

function findPlugin(plugins: PluginConfig[], name: string): PluginConfig | undefined {
  return plugins.find((plugin) => plugin.name === name);
}

async function validateInstalledPluginDefault(packageName: string, pluginHome: string): Promise<{ name: string; channels: string[] }> {
  const moduleValue = await importPluginFromHome(packageName, pluginHome);
  const plugin = validateWeacpxPlugin(moduleValue, packageName);
  return { name: plugin.name ?? packageName, channels: (plugin.channels ?? []).map((channel) => channel.type) };
}

function ensurePluginsArray(config: AppConfig): asserts config is AppConfig & { plugins: PluginConfig[] } {
  if (!config.plugins) config.plugins = [];
}

const BUILTIN_CHANNEL_TYPES = new Set<string>(["weixin"]);

function describeError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function activeChannels(config: AppConfig): Array<{ id: string; type: string }> {
  return (config.channels ?? [])
    .filter((channel) => channel.enabled !== false)
    .map((channel) => ({ id: channel.id, type: channel.type }));
}

interface DependencyGuardOutcome {
  allow: boolean;
  reason?: string;
}

async function dependencyGuard(
  pluginName: string,
  config: AppConfig,
  validate: (name: string) => Promise<{ name: string; channels: string[] }>,
): Promise<DependencyGuardOutcome> {
  let providedTypes: string[] | null;
  try {
    const summary = await validate(pluginName);
    providedTypes = summary.channels;
  } catch {
    providedTypes = null;
  }

  const channels = activeChannels(config);

  if (providedTypes !== null) {
    const provided = new Set(providedTypes);
    const blocking = channels.filter((channel) => provided.has(channel.type));
    if (blocking.length === 0) return { allow: true };
    const ids = blocking.map((channel) => channel.id).join(", ");
    return {
      allow: false,
      reason: `存在依赖该插件的频道：${ids}。请先执行 weacpx channel rm <id>（或 channel disable）后再操作。`,
    };
  }

  // Validation failed: we cannot determine which channel types this plugin
  // provides. Block when any non-builtin channel might depend on it.
  const unknownDependents = channels.filter((channel) => !BUILTIN_CHANNEL_TYPES.has(channel.type));
  if (unknownDependents.length === 0) return { allow: true };
  const ids = unknownDependents.map((channel) => `${channel.id}(${channel.type})`).join(", ");
  return {
    allow: false,
    reason: `无法确定插件 ${pluginName} 提供的频道类型，且当前仍配置了非内置频道：${ids}。请先 weacpx channel rm 它们或修复插件后再试。`,
  };
}

async function listPlugins(deps: PluginCliDeps): Promise<number> {
  const config = await deps.loadConfig();
  ensurePluginsArray(config);
  if (config.plugins.length === 0) {
    deps.print("还没有安装插件。");
    return 0;
  }
  deps.print("插件：");
  for (const plugin of config.plugins) {
    const versionLabel = plugin.version ? `@${plugin.version}` : "";
    const enabledLabel = plugin.enabled ? "enabled" : "disabled";
    deps.print(`- ${plugin.name}${versionLabel} (${enabledLabel})`);
  }
  return 0;
}

async function addPlugin(packageSpec: string, rawArgs: string[], deps: PluginCliDeps): Promise<number> {
  const flags = parseRestartAndVersionFlags(rawArgs);
  if (!flags.ok) {
    deps.print(flags.message);
    return 1;
  }
  if (flags.rest.length > 0) {
    deps.print(`未识别的参数：${flags.rest.join(" ")}`);
    return 1;
  }

  const pluginHome = deps.pluginHome ?? resolvePluginHome();
  await ensurePluginHome(pluginHome);

  const installSpec = looksLikePath(packageSpec) && !isAbsolute(packageSpec)
    ? resolve(process.cwd(), packageSpec)
    : packageSpec;
  const installInput = flags.version ? { packageName: installSpec, version: flags.version } : { packageName: installSpec };
  const namesBeforeInstall = looksLikePath(packageSpec) ? await readDependencyNames(pluginHome) : new Set<string>();
  const install = deps.installPackage ?? (async (input) => {
    await installPluginPackage({ ...input, pluginHome });
  });
  try {
    await install(installInput);
  } catch (error) {
    deps.print(`插件 ${packageSpec} 安装失败：${describeError(error)}`);
    return 1;
  }

  const recordedName = looksLikePath(packageSpec)
    ? await resolveLocalPluginName(installSpec, pluginHome, namesBeforeInstall)
    : packageSpec;

  const validate = deps.validateInstalledPlugin ?? ((name: string) => validateInstalledPluginDefault(name, pluginHome));
  let summary: { name: string; channels: string[] };
  try {
    summary = await validate(recordedName);
  } catch (error) {
    deps.print(`插件 ${recordedName} 校验失败：${describeError(error)}`);
    return 1;
  }

  const config = await deps.loadConfig();
  ensurePluginsArray(config);
  const existing = findPlugin(config.plugins, recordedName);
  const next: PluginConfig = {
    name: recordedName,
    ...(flags.version ? { version: flags.version } : {}),
    enabled: true,
  };
  if (existing) {
    config.plugins = config.plugins.map((entry) => (entry.name === recordedName ? next : entry));
  } else {
    config.plugins = [...config.plugins, next];
  }
  await deps.saveConfig(config);

  deps.print(`插件 ${recordedName} 已安装`);
  if (summary.channels.length > 0) {
    deps.print(`提供频道：${summary.channels.join(", ")}`);
  }
  return await maybeRestartAfterMutation(flags.restart, deps);
}

async function removePlugin(packageName: string, rawArgs: string[], deps: PluginCliDeps): Promise<number> {
  const flags = parseRestartAndVersionFlags(rawArgs);
  if (!flags.ok) {
    deps.print(flags.message);
    return 1;
  }
  if (flags.rest.length > 0) {
    deps.print(`未识别的参数：${flags.rest.join(" ")}`);
    return 1;
  }

  const config = await deps.loadConfig();
  ensurePluginsArray(config);
  const existing = findPlugin(config.plugins, packageName);
  if (!existing) {
    deps.print(`没有找到插件：${packageName}`);
    return 1;
  }

  const pluginHome = deps.pluginHome ?? resolvePluginHome();
  const validate = deps.validateInstalledPlugin ?? ((name: string) => validateInstalledPluginDefault(name, pluginHome));
  const guard = await dependencyGuard(packageName, config, validate);
  if (!guard.allow) {
    if (guard.reason) deps.print(guard.reason);
    return 1;
  }

  const remove = deps.removePackage ?? (async (name: string) => {
    await removePluginPackage({ packageName: name, pluginHome });
  });
  try {
    await remove(packageName);
  } catch (error) {
    deps.print(`插件 ${packageName} 卸载失败：${describeError(error)}`);
    return 1;
  }

  config.plugins = config.plugins.filter((entry) => entry.name !== packageName);
  await deps.saveConfig(config);
  deps.print(`插件 ${packageName} 已移除`);
  return await maybeRestartAfterMutation(flags.restart, deps);
}

async function updatePlugins(args: string[], deps: PluginCliDeps): Promise<number> {
  const target = args[0];
  if (!target) return 1;
  const flags = parseRestartAndVersionFlags(args.slice(1));
  if (!flags.ok) {
    deps.print(flags.message);
    return 1;
  }
  if (flags.rest.length > 0) {
    deps.print(`未识别的参数：${flags.rest.join(" ")}`);
    return 1;
  }
  if (target === "--all" && flags.version) {
    deps.print("--all cannot be combined with --version");
    return 1;
  }

  const config = await deps.loadConfig();
  ensurePluginsArray(config);
  const pluginHome = deps.pluginHome ?? resolvePluginHome();
  await ensurePluginHome(pluginHome);
  const update = deps.updatePackage ?? (async (input) => {
    await updatePluginPackage({ ...input, pluginHome });
  });
  const validate = deps.validateInstalledPlugin ?? ((name: string) => validateInstalledPluginDefault(name, pluginHome));

  const targets = target === "--all"
    ? [...config.plugins]
    : (() => {
        const existing = findPlugin(config.plugins, target);
        return existing ? [existing] : [];
      })();

  if (targets.length === 0) {
    deps.print(`没有找到插件：${target}`);
    return 1;
  }

  for (const existing of targets) {
    const nextVersion = flags.version ?? existing.version;
    const updateInput = nextVersion ? { packageName: existing.name, version: nextVersion } : { packageName: existing.name };
    try {
      await update(updateInput);
    } catch (error) {
      deps.print(`插件 ${existing.name} 更新失败：${describeError(error)}`);
      return 1;
    }
    let summary: { name: string; channels: string[] };
    try {
      summary = await validate(existing.name);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      deps.print(`插件 ${existing.name} 更新后校验失败：${message}`);
      // Roll back the npm install to the version recorded in config so that
      // the on-disk package matches plugins[].version. If we never had a
      // pinned version, there is no clean rollback target.
      if (existing.version && existing.version !== nextVersion) {
        try {
          await update({ packageName: existing.name, version: existing.version });
          deps.print(`已回滚到 ${existing.version}`);
        } catch (rollbackError) {
          const rollbackMessage = rollbackError instanceof Error ? rollbackError.message : String(rollbackError);
          deps.print(`回滚 ${existing.name} 到 ${existing.version} 失败：${rollbackMessage}`);
        }
      } else if (!existing.version) {
        deps.print(`无法自动回滚（${existing.name} 未锁定先前版本）；请手动 weacpx plugin add ${existing.name} 重装。`);
      }
      return 1;
    }
    const next: PluginConfig = {
      name: existing.name,
      ...(nextVersion ? { version: nextVersion } : {}),
      enabled: existing.enabled,
    };
    config.plugins = config.plugins.map((entry) => (entry.name === existing.name ? next : entry));
    deps.print(`插件 ${existing.name} 已更新`);
    if (summary.channels.length > 0) {
      deps.print(`提供频道：${summary.channels.join(", ")}`);
    }
  }

  await deps.saveConfig(config);
  return await maybeRestartAfterMutation(flags.restart, deps);
}

async function setPluginEnabled(packageName: string, enabled: boolean, rawArgs: string[], deps: PluginCliDeps): Promise<number> {
  const flags = parseRestartAndVersionFlags(rawArgs);
  if (!flags.ok) {
    deps.print(flags.message);
    return 1;
  }
  if (flags.rest.length > 0) {
    deps.print(`未识别的参数：${flags.rest.join(" ")}`);
    return 1;
  }
  const config = await deps.loadConfig();
  ensurePluginsArray(config);
  const existing = findPlugin(config.plugins, packageName);
  if (!existing) {
    deps.print(`没有找到插件：${packageName}`);
    return 1;
  }

  if (!enabled) {
    const pluginHome = deps.pluginHome ?? resolvePluginHome();
    const validate = deps.validateInstalledPlugin ?? ((name: string) => validateInstalledPluginDefault(name, pluginHome));
    const guard = await dependencyGuard(packageName, config, validate);
    if (!guard.allow) {
      if (guard.reason) deps.print(guard.reason);
      return 1;
    }
  }

  existing.enabled = enabled;
  await deps.saveConfig(config);
  deps.print(`插件 ${packageName} 已${enabled ? "启用" : "禁用"}`);
  return await maybeRestartAfterMutation(flags.restart, deps);
}

function formatDoctorIssue(issue: PluginDoctorIssue): string {
  const level = issue.level.toUpperCase();
  return issue.plugin ? `${level} ${issue.plugin}: ${issue.message}` : `${level}: ${issue.message}`;
}

async function doctorPlugins(pluginName: string | undefined, deps: PluginCliDeps): Promise<number> {
  const config = await deps.loadConfig();
  ensurePluginsArray(config);
  const pluginHome = deps.pluginHome ?? resolvePluginHome();
  const inspect = deps.inspectPlugins ?? inspectPlugins;
  const issues = await inspect({ config, pluginHome, ...(pluginName ? { pluginName } : {}) });
  if (issues.length === 0) {
    deps.print("插件检查通过。");
    return 0;
  }
  for (const issue of issues) deps.print(formatDoctorIssue(issue));
  return issues.some((issue) => issue.level === "error") ? 1 : 0;
}

async function knownPlugins(rawArgs: string[], deps: PluginCliDeps): Promise<number> {
  let json = false;
  for (const arg of rawArgs) {
    if (arg === "--json") {
      json = true;
      continue;
    }
    deps.print(`未识别的参数：${arg}`);
    return 1;
  }

  const plugins = listKnownPlugins();
  if (json) {
    deps.print(JSON.stringify(plugins.map((plugin) => ({
      packageName: plugin.packageName,
      channels: plugin.channels,
      description: plugin.description,
      official: plugin.official,
    }))));
    return 0;
  }

  if (plugins.length === 0) {
    deps.print("当前版本没有官方插件。");
    return 0;
  }

  const channelWidth = Math.max(...plugins.map((plugin) => plugin.channels.join(",").length));
  const packageWidth = Math.max(...plugins.map((plugin) => plugin.packageName.length));
  deps.print("官方插件：");
  for (const plugin of plugins) {
    const channelLabel = plugin.channels.join(",").padEnd(channelWidth, " ");
    const packageLabel = plugin.packageName.padEnd(packageWidth, " ");
    deps.print(`- ${channelLabel}  ${packageLabel}  ${plugin.description}`);
  }
  deps.print("");
  deps.print("安装：");
  deps.print("  weacpx plugin add <package>");
  return 0;
}

async function maybeRestartAfterMutation(choice: RestartChoice, deps: PluginCliDeps): Promise<number> {
  if (choice === "no-restart") {
    deps.print("配置已保存；变更会在下次 `weacpx restart` 后生效。");
    return 0;
  }
  const status = await deps.getDaemonStatus();
  if (choice === "restart") {
    if (status.state === "indeterminate") {
      deps.print("配置已保存；daemon 状态异常，已跳过自动重启。请先处理 stale PID/status。");
      return 0;
    }
    return await runRestart(deps);
  }
  if (status.state === "running") {
    if (!deps.isInteractive()) {
      deps.print("配置已保存；daemon 正在运行，请执行 `weacpx restart` 使变更生效。");
      return 0;
    }
    const answer = (await deps.promptText("现在重启 weacpx 使变更生效？[y/N] ")).trim().toLowerCase();
    if (answer === "y" || answer === "yes") return await runRestart(deps);
    deps.print("配置已保存；变更会在下次 `weacpx restart` 后生效。");
    return 0;
  }
  if (status.state === "indeterminate") {
    deps.print("配置已保存；daemon 状态异常，已跳过自动重启。请先处理 stale PID/status。");
    return 0;
  }
  deps.print("配置已保存；daemon 未运行，变更会在下次 `weacpx start` 后生效。");
  return 0;
}

async function runRestart(deps: PluginCliDeps): Promise<number> {
  try {
    return await deps.restartDaemon();
  } catch (error) {
    deps.print(`配置已保存，但重启失败：${describeError(error)}`);
    deps.print("请查看日志：~/.weacpx/runtime/stderr.log");
    deps.print("也可以稍后执行：weacpx start");
    return 1;
  }
}
