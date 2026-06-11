import { loadConfig as defaultLoadConfig } from "../../config/load-config";
import type { AppConfig } from "../../config/types";
import { listKnownChannelIds } from "../../channels/channel-scope";
import { resolveRuntimePaths as defaultResolveRuntimePaths, type RuntimePaths } from "../../main";
import {
  inspectPlugins as defaultInspectPlugins,
  type InspectPluginsInput,
  type PluginDoctorIssue,
} from "../../plugins/plugin-doctor";
import { resolvePluginHome as defaultResolvePluginHome } from "../../plugins/plugin-home";
import { XACPX_CORE_VERSION } from "../../version";
import type { DoctorCheckResult } from "../doctor-types";

export interface PluginCheckOptions {
  /** Home dir used to resolve the plugin home; mirrors the rest of doctor. */
  home?: string;
  resolveRuntimePaths?: () => RuntimePaths;
  loadConfig?: (configPath: string) => Promise<AppConfig>;
  resolvePluginHome?: (input: { home?: string }) => string;
  inspectPlugins?: (input: InspectPluginsInput) => Promise<PluginDoctorIssue[]>;
  /** Injected for tests; defaults to the running core version. */
  currentXacpxVersion?: string;
}

/**
 * Fold the existing plugin/channel health logic (`inspectPlugins`, previously
 * only reachable via `xacpx plugin doctor`) into `xacpx doctor`. This is the
 * check that catches a channel plugin that fails to load after a core update
 * (e.g. `failed to import plugin: Cannot find module ...`).
 *
 * Read-only: plugin (re)install needs the network, so this check never attaches
 * a fix — it only surfaces actionable `xacpx plugin ...` suggestions.
 */
export async function checkPlugins(options: PluginCheckOptions = {}): Promise<DoctorCheckResult> {
  const runtimePaths = (options.resolveRuntimePaths ?? defaultResolveRuntimePaths)();

  let config: AppConfig;
  try {
    config = await (options.loadConfig ?? defaultLoadConfig)(runtimePaths.configPath);
  } catch (error) {
    return {
      id: "plugins",
      label: "Plugins",
      severity: "skip",
      summary: "plugin check skipped because configuration could not be loaded",
      details: [`config path: ${runtimePaths.configPath}`, `error: ${formatError(error)}`],
      suggestions: ["fix the Config check first, then run: xacpx doctor"],
    };
  }

  if (!hasPluginSurface(config)) {
    return {
      id: "plugins",
      label: "Plugins",
      severity: "skip",
      summary: "no plugins configured",
    };
  }

  const pluginHome = (options.resolvePluginHome ?? defaultResolvePluginHome)({ home: options.home });
  const inspect = options.inspectPlugins ?? defaultInspectPlugins;

  let issues: PluginDoctorIssue[];
  try {
    issues = await inspect({
      config,
      pluginHome,
      currentXacpxVersion: options.currentXacpxVersion ?? XACPX_CORE_VERSION,
    });
  } catch (error) {
    // A throw here must never crash runDoctor — degrade to a fail, mirroring
    // the orchestration sibling's inspect guard.
    return {
      id: "plugins",
      label: "Plugins",
      severity: "fail",
      summary: "plugin health check failed",
      details: [`plugin home: ${pluginHome}`, `error: ${formatError(error)}`],
    };
  }

  const errorCount = issues.filter((issue) => issue.level === "error").length;
  const warnCount = issues.filter((issue) => issue.level === "warn").length;
  const severity = errorCount > 0 ? "fail" : warnCount > 0 ? "warn" : "pass";
  const problemCount = errorCount + warnCount;

  return {
    id: "plugins",
    label: "Plugins",
    severity,
    summary:
      problemCount > 0
        ? `${problemCount} plugin issue(s)`
        : "all plugins healthy",
    // Match the sibling checks' altitude: only surface the problems, not the
    // healthy plugins (the summary already says "all plugins healthy").
    details: issues.filter((issue) => issue.level !== "ok").map(formatIssueDetail),
    suggestions: collectSuggestions(issues),
    metadata: { pluginHome, errorCount, warnCount },
  };
}

/**
 * True when there is anything for the plugin check to inspect: at least one
 * configured plugin, or at least one enabled channel whose type is not a
 * built-in (i.e. a plugin-provided channel). Otherwise the check skips.
 */
function hasPluginSurface(config: AppConfig): boolean {
  if ((config.plugins ?? []).length > 0) {
    return true;
  }
  const builtInChannelTypes = new Set(listKnownChannelIds());
  return (config.channels ?? []).some(
    (channel) => channel.enabled !== false && !builtInChannelTypes.has(channel.type),
  );
}

function formatIssueDetail(issue: PluginDoctorIssue): string {
  return issue.plugin ? `${issue.plugin}: ${issue.message}` : issue.message;
}

/**
 * Collect the structured `suggestion` remediation commands the issues already
 * carry (deduped, in order). The precise command is set at the source in
 * `inspectPlugins`, so there is no message parsing here.
 */
function collectSuggestions(issues: PluginDoctorIssue[]): string[] {
  const suggestions: string[] = [];
  const seen = new Set<string>();

  for (const issue of issues) {
    const suggestion = issue.suggestion;
    if (suggestion && !seen.has(suggestion)) {
      seen.add(suggestion);
      suggestions.push(`run: ${suggestion}`);
    }
  }

  return suggestions;
}

function formatError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
