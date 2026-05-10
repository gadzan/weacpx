import { bootstrapBuiltinChannelFactories } from "./create-channel.js";
import { bootstrapBuiltinChannelCliProviders } from "./cli/registry.js";

export function bootstrapBuiltinChannels(): void {
  bootstrapBuiltinChannelFactories();
  bootstrapBuiltinChannelCliProviders();
}
