import { writePrivateFileAtomic } from "../util/private-file.js";

import { loadConfig } from "./load-config";
import type { AppConfig, WorkspaceConfig } from "./types";

export class ConfigStore {
  constructor(private readonly path: string) {}

  async load(): Promise<AppConfig> {
    return await loadConfig(this.path);
  }

  async save(config: AppConfig): Promise<void> {
    await writePrivateFileAtomic(this.path, `${JSON.stringify(config, null, 2)}\n`);
  }

  async upsertWorkspace(name: string, cwd: string, description?: string): Promise<AppConfig> {
    const config = await this.load();
    const workspace: WorkspaceConfig = {
      cwd,
      ...(description ? { description } : {}),
    };

    config.workspaces[name] = workspace;
    await this.save(config);
    return config;
  }

  async removeWorkspace(name: string): Promise<AppConfig> {
    const config = await this.load();
    delete config.workspaces[name];
    await this.save(config);
    return config;
  }

  async upsertAgent(name: string, agent: AppConfig["agents"][string]): Promise<AppConfig> {
    const config = await this.load();
    config.agents[name] = agent;
    await this.save(config);
    return config;
  }

  async removeAgent(name: string): Promise<AppConfig> {
    const config = await this.load();
    delete config.agents[name];
    await this.save(config);
    return config;
  }

  async updateTransport(transport: Partial<AppConfig["transport"]>): Promise<AppConfig> {
    const config = await this.load();
    config.transport = {
      ...config.transport,
      ...transport,
    };
    await this.save(config);
    return config;
  }

  async updateWechat(wechat: Partial<AppConfig["wechat"]>): Promise<AppConfig> {
    const config = await this.load();
    config.wechat = {
      ...config.wechat,
      ...wechat,
    };
    await this.save(config);
    return config;
  }
}
