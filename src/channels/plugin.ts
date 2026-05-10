import type { ChannelFactory } from "./create-channel.js";
import {
  bootstrapBuiltinChannelFactories,
  hasChannelFactory,
  registerChannelFactory,
} from "./create-channel.js";
import type { ChannelCliProvider } from "./cli/provider.js";
import {
  bootstrapBuiltinChannelCliProviders,
  hasChannelCliProvider,
  registerChannelCliProvider,
} from "./cli/registry.js";

export interface ChannelPluginDefinition {
  /** Stable channel type used in channels[].type and chatKey prefix. */
  type: string;
  factory: ChannelFactory;
  cliProvider?: ChannelCliProvider;
}

export function registerChannelPlugin(plugin: ChannelPluginDefinition): void {
  bootstrapBuiltinChannelFactories();
  bootstrapBuiltinChannelCliProviders();

  const channelType = plugin.type.trim();
  if (channelType && hasChannelFactory(channelType)) {
    throw new Error(`channel type is already registered: ${channelType}`);
  }

  const cliProviderType = plugin.cliProvider?.type.trim();
  if (cliProviderType && hasChannelCliProvider(cliProviderType)) {
    throw new Error(`channel CLI provider is already registered: ${cliProviderType}`);
  }

  registerChannelFactory(plugin.type, plugin.factory);
  if (plugin.cliProvider) registerChannelCliProvider(plugin.cliProvider);
}
