import type { AppConfig } from "../config/types";

export function cloneAppConfig(config: AppConfig): AppConfig {
  return {
    transport: { ...config.transport },
    logging: { ...config.logging },
    wechat: { ...config.wechat },
    agents: Object.fromEntries(Object.entries(config.agents).map(([name, agent]) => [name, { ...agent }])),
    workspaces: Object.fromEntries(
      Object.entries(config.workspaces).map(([name, workspace]) => [name, { ...workspace }]),
    ),
  };
}
