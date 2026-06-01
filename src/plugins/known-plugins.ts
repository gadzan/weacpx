export interface KnownPlugin {
  packageName: string;
  channels: string[];
  description: string;
  official: true;
}

const KNOWN_PLUGINS: ReadonlyArray<KnownPlugin> = [
  {
    packageName: "@ganglion/xacpx-channel-feishu",
    channels: ["feishu"],
    description: "飞书频道",
    official: true,
  },
  {
    packageName: "@ganglion/xacpx-channel-yuanbao",
    channels: ["yuanbao"],
    description: "腾讯元宝频道",
    official: true,
  },
];

export function listKnownPlugins(): KnownPlugin[] {
  return KNOWN_PLUGINS.map((plugin) => ({ ...plugin, channels: [...plugin.channels] }));
}

export function findKnownPluginByChannel(channelType: string): KnownPlugin | null {
  const match = KNOWN_PLUGINS.find((plugin) => plugin.channels.includes(channelType));
  return match ? { ...match, channels: [...match.channels] } : null;
}

export function getMovedChannelInstallHint(channelType: string): string | null {
  const plugin = findKnownPluginByChannel(channelType);
  return plugin ? `频道 ${channelType} 需要安装插件：xacpx plugin add ${plugin.packageName}` : null;
}
