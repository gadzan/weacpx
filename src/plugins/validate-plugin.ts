import { isRecord } from "../config/load-config.js";
import { readVersion } from "../version.js";
import type { WeacpxPlugin } from "./types.js";
import { WEACPX_PLUGIN_API_VERSION } from "./types.js";
import { validatePluginCompatibility } from "./compatibility.js";

export interface ValidateWeacpxPluginOptions {
  /**
   * Current weacpx core version. Defaults to `readVersion()`. Pass an explicit
   * value in tests so the result does not depend on the dev/install layout.
   * Use `"unknown"` to skip core-version compatibility (matches readVersion's
   * fallback when package.json is missing).
   */
  currentWeacpxVersion?: string;
}

export function validateWeacpxPlugin(
  value: unknown,
  packageName: string,
  options: ValidateWeacpxPluginOptions = {},
): WeacpxPlugin {
  const plugin = isRecord(value) && "default" in value ? value.default : value;
  if (!isRecord(plugin)) {
    throw new Error(`插件 ${packageName} 没有默认导出 xacpx plugin definition`);
  }

  const currentWeacpxVersion = options.currentWeacpxVersion ?? readVersion();
  validatePluginCompatibility(
    {
      apiVersion: plugin.apiVersion,
      minWeacpxVersion: (plugin as Record<string, unknown>).minWeacpxVersion,
      compatibleWeacpxVersions: (plugin as Record<string, unknown>).compatibleWeacpxVersions,
      minXacpxVersion: (plugin as Record<string, unknown>).minXacpxVersion,
      compatibleXacpxVersions: (plugin as Record<string, unknown>).compatibleXacpxVersions,
    },
    { packageName, currentWeacpxVersion },
  );

  if ("name" in plugin && typeof plugin.name === "string" && plugin.name.trim() && plugin.name.trim() !== packageName) {
    throw new Error(`插件 ${packageName} 声明的 name 与安装包名不一致：${plugin.name}`);
  }
  if ("channels" in plugin && plugin.channels !== undefined && !Array.isArray(plugin.channels)) {
    throw new Error(`插件 ${packageName} 的 channels 必须是数组`);
  }

  const channels = Array.isArray(plugin.channels) ? plugin.channels : [];
  const seenTypes = new Set<string>();
  for (const channel of channels) {
    if (!isRecord(channel) || typeof channel.type !== "string" || !channel.type.trim() || channel.type.includes(":")) {
      const type = isRecord(channel) && "type" in channel ? String(channel.type) : "";
      throw new Error(type ? `插件 ${packageName} 注册了非法频道类型：${type}` : `插件 ${packageName} 注册了非法频道类型`);
    }
    const type = channel.type.trim();
    if (seenTypes.has(type)) {
      throw new Error(`插件 ${packageName} 重复注册频道类型：${type}`);
    }
    seenTypes.add(type);
    if (typeof channel.factory !== "function") {
      throw new Error(`插件 ${packageName} 的频道 ${type} 缺少 factory`);
    }
    if ("cliProvider" in channel && channel.cliProvider !== undefined) {
      if (!isRecord(channel.cliProvider) || channel.cliProvider.type !== type) {
        throw new Error(`插件 ${packageName} 的频道 ${type} cliProvider.type 必须等于频道 type`);
      }
    }
  }

  const normalized: WeacpxPlugin = {
    apiVersion: WEACPX_PLUGIN_API_VERSION,
    ...(typeof plugin.name === "string" && plugin.name.trim() ? { name: plugin.name.trim() } : { name: packageName }),
    channels: channels as WeacpxPlugin["channels"],
  };
  if (typeof plugin.minWeacpxVersion === "string") normalized.minWeacpxVersion = plugin.minWeacpxVersion;
  if (typeof plugin.compatibleWeacpxVersions === "string") normalized.compatibleWeacpxVersions = plugin.compatibleWeacpxVersions;
  if (typeof plugin.minXacpxVersion === "string") normalized.minXacpxVersion = plugin.minXacpxVersion;
  if (typeof plugin.compatibleXacpxVersions === "string") normalized.compatibleXacpxVersions = plugin.compatibleXacpxVersions;
  return normalized;
}
