import { isRecord } from "../config/load-config.js";
import { readVersion } from "../version.js";
import type { WeacpxPlugin } from "./types.js";
import { XACPX_PLUGIN_API_VERSION } from "./types.js";
import { validatePluginCompatibility } from "./compatibility.js";
import { t } from "../i18n";

export interface ValidateWeacpxPluginOptions {
  /**
   * Current weacpx core version. Defaults to `readVersion()`. Pass an explicit
   * value in tests so the result does not depend on the dev/install layout.
   * Use `"unknown"` to skip core-version compatibility (matches readVersion's
   * fallback when package.json is missing).
   */
  currentXacpxVersion?: string;
}

export function validateWeacpxPlugin(
  value: unknown,
  packageName: string,
  options: ValidateWeacpxPluginOptions = {},
): WeacpxPlugin {
  const plugin = isRecord(value) && "default" in value ? value.default : value;
  if (!isRecord(plugin)) {
    throw new Error(t().pluginCli.pluginNoDefaultExport(packageName));
  }

  const currentXacpxVersion = options.currentXacpxVersion ?? readVersion();
  validatePluginCompatibility(
    {
      apiVersion: plugin.apiVersion,
      minWeacpxVersion: (plugin as Record<string, unknown>).minWeacpxVersion,
      compatibleWeacpxVersions: (plugin as Record<string, unknown>).compatibleWeacpxVersions,
      minXacpxVersion: (plugin as Record<string, unknown>).minXacpxVersion,
      compatibleXacpxVersions: (plugin as Record<string, unknown>).compatibleXacpxVersions,
    },
    { packageName, currentXacpxVersion },
  );

  if ("name" in plugin && typeof plugin.name === "string" && plugin.name.trim() && plugin.name.trim() !== packageName) {
    throw new Error(t().pluginCli.pluginNameMismatch(packageName, plugin.name));
  }
  if ("channels" in plugin && plugin.channels !== undefined && !Array.isArray(plugin.channels)) {
    throw new Error(t().pluginCli.pluginChannelsNotArray(packageName));
  }

  const channels = Array.isArray(plugin.channels) ? plugin.channels : [];
  const seenTypes = new Set<string>();
  for (const channel of channels) {
    if (!isRecord(channel) || typeof channel.type !== "string" || !channel.type.trim() || channel.type.includes(":")) {
      const type = isRecord(channel) && "type" in channel ? String(channel.type) : "";
      throw new Error(type ? t().pluginCli.pluginIllegalChannelType(packageName, type) : t().pluginCli.pluginIllegalChannelTypeNoType(packageName));
    }
    const type = channel.type.trim();
    if (seenTypes.has(type)) {
      throw new Error(t().pluginCli.pluginDuplicateChannelType(packageName, type));
    }
    seenTypes.add(type);
    if (typeof channel.factory !== "function") {
      throw new Error(t().pluginCli.pluginMissingFactory(packageName, type));
    }
    if ("cliProvider" in channel && channel.cliProvider !== undefined) {
      if (!isRecord(channel.cliProvider) || channel.cliProvider.type !== type) {
        throw new Error(t().pluginCli.pluginInvalidCliProvider(packageName, type));
      }
    }
  }

  const normalized: WeacpxPlugin = {
    apiVersion: XACPX_PLUGIN_API_VERSION,
    ...(typeof plugin.name === "string" && plugin.name.trim() ? { name: plugin.name.trim() } : { name: packageName }),
    channels: channels as WeacpxPlugin["channels"],
  };
  if (typeof plugin.minWeacpxVersion === "string") normalized.minWeacpxVersion = plugin.minWeacpxVersion;
  if (typeof plugin.compatibleWeacpxVersions === "string") normalized.compatibleWeacpxVersions = plugin.compatibleWeacpxVersions;
  if (typeof plugin.minXacpxVersion === "string") normalized.minXacpxVersion = plugin.minXacpxVersion;
  if (typeof plugin.compatibleXacpxVersions === "string") normalized.compatibleXacpxVersions = plugin.compatibleXacpxVersions;
  return normalized;
}
