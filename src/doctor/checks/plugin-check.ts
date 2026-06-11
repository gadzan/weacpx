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
  const issues = await inspect({
    config,
    pluginHome,
    currentXacpxVersion: options.currentXacpxVersion ?? XACPX_CORE_VERSION,
  });

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
    details: issues.map(formatIssueDetail),
    suggestions: collectSuggestions(issues),
    metadata: { pluginHome, issues },
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
 * Build a deduped, actionable suggestion list. Common errors (package not
 * installed / failed to import) get an explicit add+restart hint keyed by the
 * affected package; other messages that already embed an `xacpx plugin ...`
 * remediation hint are surfaced verbatim.
 */
function collectSuggestions(issues: PluginDoctorIssue[]): string[] {
  const suggestions: string[] = [];
  const seen = new Set<string>();
  const push = (suggestion: string) => {
    if (!seen.has(suggestion)) {
      seen.add(suggestion);
      suggestions.push(suggestion);
    }
  };

  for (const issue of issues) {
    if (issue.level === "ok") {
      continue;
    }
    if (
      issue.plugin &&
      (issue.message.startsWith("package not installed") ||
        issue.message.startsWith("failed to import plugin"))
    ) {
      push(`run: xacpx plugin add ${issue.plugin} && xacpx restart`);
      continue;
    }
    const embedded = extractPluginCommand(issue.message);
    if (embedded) {
      push(`run: ${embedded}`);
    }
  }

  return suggestions;
}

/**
 * Pull the first `xacpx plugin ...` remediation command embedded in a message
 * (the issue strings already carry these). Returns null when none is present.
 */
function extractPluginCommand(message: string): string | null {
  const match = message.match(/xacpx plugin [^;]+/);
  return match ? match[0].trim() : null;
}

function formatError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
