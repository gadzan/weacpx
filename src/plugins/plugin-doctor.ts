import { readFile } from "node:fs/promises";
import { join } from "node:path";

import type { AppConfig } from "../config/types.js";
import { listKnownChannelIds } from "../channels/channel-scope.js";
import { importPluginFromHome } from "./plugin-loader.js";
import { validateWeacpxPlugin } from "./validate-plugin.js";
import { findKnownPluginByChannel } from "./known-plugins.js";
import { normalizePluginPackageName } from "./plugin-renames.js";

function suggestedPluginPackageForChannel(type: string): string {
  return findKnownPluginByChannel(type)?.packageName ?? `<npm-package-that-provides-${type}>`;
}

export type PluginDoctorLevel = "ok" | "warn" | "error";

export interface PluginDoctorIssue {
  level: PluginDoctorLevel;
  plugin?: string;
  message: string;
}

export interface InspectPluginsInput {
  config: AppConfig;
  pluginHome: string;
  pluginName?: string;
  importPlugin?: (packageName: string, pluginHome: string) => Promise<unknown>;
  currentXacpxVersion?: string;
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
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`failed to read plugin home package.json: ${message}`);
  }
}

export async function inspectPlugins(input: InspectPluginsInput): Promise<PluginDoctorIssue[]> {
  const issues: PluginDoctorIssue[] = [];
  let dependencies: Record<string, string>;
  try {
    dependencies = await readDependencyEntries(input.pluginHome);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return [{ level: "error", message }];
  }

  const importPlugin = input.importPlugin ?? importPluginFromHome;
  const allConfigured = input.config.plugins;
  const filterByName = input.pluginName ? normalizePluginPackageName(input.pluginName) : null;

  if (filterByName && !allConfigured.some((plugin) => normalizePluginPackageName(plugin.name) === filterByName)) {
    return [{ level: "error", plugin: filterByName, message: `plugin is not configured; run xacpx plugin add ${filterByName}` }];
  }

  const pushIfRelevant = (issue: PluginDoctorIssue) => {
    if (!filterByName || issue.plugin === filterByName) issues.push(issue);
  };

  const channelProviders = new Map<string, { plugin: string; enabled: boolean }>();

  for (const configPlugin of allConfigured) {
    if (!(configPlugin.name in dependencies)) {
      pushIfRelevant({ level: "error", plugin: configPlugin.name, message: `package not installed in plugin home; run xacpx plugin add ${configPlugin.name}` });
      continue;
    }

    let moduleValue: unknown;
    try {
      moduleValue = await importPlugin(configPlugin.name, input.pluginHome);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      pushIfRelevant({ level: "error", plugin: configPlugin.name, message: `failed to import plugin: ${message}` });
      continue;
    }

    try {
      const plugin = validateWeacpxPlugin(moduleValue, configPlugin.name, {
        ...(input.currentXacpxVersion !== undefined ? { currentXacpxVersion: input.currentXacpxVersion } : {}),
      });
      const channels = plugin.channels ?? [];
      const channelTypes = channels.map((channel) => channel.type);
      for (const type of channelTypes) {
        const existing = channelProviders.get(type);
        if (existing) {
          pushIfRelevant({ level: "error", plugin: configPlugin.name, message: `channel type ${type} is already provided by ${existing.plugin}` });
        } else {
          channelProviders.set(type, { plugin: configPlugin.name, enabled: configPlugin.enabled });
        }
      }
      pushIfRelevant({
        level: configPlugin.enabled ? "ok" : "warn",
        plugin: configPlugin.name,
        message: configPlugin.enabled
          ? `plugin is installed and valid; channels: ${channelTypes.length > 0 ? channelTypes.join(", ") : "none"}`
          : `plugin is installed and valid but disabled; run xacpx plugin enable ${configPlugin.name}`,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      pushIfRelevant({ level: "error", plugin: configPlugin.name, message });
    }
  }

  const builtInChannelTypes = new Set(listKnownChannelIds());
  for (const channel of input.config.channels) {
    if (channel.enabled === false) continue;
    if (builtInChannelTypes.has(channel.type)) continue;
    const provider = channelProviders.get(channel.type);
    if (!provider) {
      if (!filterByName) {
        issues.push({
          level: "error",
          message: `channel ${channel.type} is configured but no enabled plugin provides it; run xacpx plugin add ${suggestedPluginPackageForChannel(channel.type)} or another plugin that provides type "${channel.type}"`,
        });
      }
      continue;
    }
    if (!provider.enabled) {
      pushIfRelevant({
        level: "error",
        plugin: provider.plugin,
        message: `channel ${channel.type} is configured but provider plugin is disabled; run xacpx plugin enable ${provider.plugin}`,
      });
    }
  }

  return issues;
}
