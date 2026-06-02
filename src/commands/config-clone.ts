import type { AppConfig } from "../config/types";

export function cloneAppConfig(config: AppConfig): AppConfig {
  return {
    transport: { ...config.transport },
    logging: { ...config.logging },
    channel: {
      ...config.channel,
      ...(config.channel.options ? { options: { ...config.channel.options } } : {}),
    },
    channels: config.channels.map((channel) => ({
      ...channel,
      ...(channel.options ? { options: { ...channel.options } } : {}),
    })),
    plugins: config.plugins.map((plugin) => ({ ...plugin })),
    agents: Object.fromEntries(Object.entries(config.agents).map(([name, agent]) => [name, { ...agent }])),
    workspaces: Object.fromEntries(
      Object.entries(config.workspaces).map(([name, workspace]) => [name, { ...workspace }]),
    ),
    orchestration: {
      ...config.orchestration,
      allowedAgentRequestTargets: [...config.orchestration.allowedAgentRequestTargets],
      allowedAgentRequestRoles: [...config.orchestration.allowedAgentRequestRoles],
    },
    ...(config.language ? { language: config.language } : {}),
  };
}
