import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";
import { join } from "node:path";

import type { PluginConfig } from "../config/types.js";
import { registerChannelPlugin } from "../channels/plugin.js";
import { validateWeacpxPlugin } from "./validate-plugin.js";
import { ensurePluginHome, resolvePluginHome } from "./plugin-home.js";

export interface LoadedPluginSummary {
  name: string;
  channels: string[];
}

export interface LoadConfiguredPluginsInput {
  plugins: PluginConfig[];
  pluginHome?: string;
  importPlugin?: (packageName: string, pluginHome: string) => Promise<unknown>;
  /**
   * Override the weacpx core version reported to plugin compatibility checks.
   * Defaults to the value embedded in `validateWeacpxPlugin` (i.e. `readVersion()`).
   */
  currentWeacpxVersion?: string;
}

export async function importPluginFromHome(packageName: string, pluginHome: string): Promise<unknown> {
  const requireFromHome = createRequire(join(pluginHome, "package.json"));
  const entry = requireFromHome.resolve(packageName);
  return await import(pathToFileURL(entry).href);
}

export async function loadConfiguredPlugins(input: LoadConfiguredPluginsInput): Promise<LoadedPluginSummary[]> {
  const enabled = input.plugins.filter((plugin) => plugin.enabled);
  if (enabled.length === 0) return [];
  const pluginHome = input.pluginHome ?? resolvePluginHome();
  await ensurePluginHome(pluginHome);
  const importPlugin = input.importPlugin ?? importPluginFromHome;
  const loaded: LoadedPluginSummary[] = [];

  for (const config of enabled) {
    let moduleValue: unknown;
    try {
      moduleValue = await importPlugin(config.name, pluginHome);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      throw new Error(`failed to load plugin ${config.name}: ${message}`);
    }
    const plugin = validateWeacpxPlugin(moduleValue, config.name, {
      ...(input.currentWeacpxVersion !== undefined ? { currentWeacpxVersion: input.currentWeacpxVersion } : {}),
    });
    const channels = plugin.channels ?? [];
    for (const channel of channels) {
      registerChannelPlugin(channel);
    }
    loaded.push({ name: config.name, channels: channels.map((channel) => channel.type) });
  }

  return loaded;
}
