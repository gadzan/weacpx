const LEGACY_PLUGIN_PACKAGE_RENAMES = new Map<string, string>([
  ["@ganglion/weacpx-channel-feishu", "@ganglion/xacpx-channel-feishu"],
  ["@ganglion/weacpx-channel-yuanbao", "@ganglion/xacpx-channel-yuanbao"],
]);

export function normalizePluginPackageName(packageName: string): string {
  return LEGACY_PLUGIN_PACKAGE_RENAMES.get(packageName) ?? packageName;
}

export function isLegacyPluginPackageName(packageName: string): boolean {
  return LEGACY_PLUGIN_PACKAGE_RENAMES.has(packageName);
}
