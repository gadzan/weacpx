import { mock } from "bun:test";
import type { ConfigStore } from "../../../src/config/config-store";
import type { AppConfig } from "../../../src/config/types";
import { createEmptyState } from "../../../src/state/types";
import type { AppState } from "../../../src/state/types";
import type { StateStore } from "../../../src/state/state-store";
import { SessionService } from "../../../src/sessions/session-service";
import type { ResolvedSession, SessionTransport } from "../../../src/transport/types";
import type { AppLogger } from "../../../src/logging/app-logger";

export function createConfig(): AppConfig {
  return {
    transport: {
      type: "acpx-cli",
      command: "acpx",
      permissionMode: "approve-all",
      nonInteractivePermissions: "deny",
    },
    logging: {
      level: "info",
      maxSizeBytes: 2 * 1024 * 1024,
      maxFiles: 5,
      retentionDays: 7,
    },
    wechat: {
      replyMode: "stream",
    },
    agents: {
      codex: { driver: "codex" },
    },
    workspaces: {
      backend: {
        cwd: "/tmp/backend",
      },
    },
  };
}

export class MemoryStateStore implements Pick<StateStore, "save"> {
  async save(_state: AppState): Promise<void> {}
}

export class MemoryConfigStore
  implements Pick<ConfigStore, "save" | "upsertWorkspace" | "removeWorkspace" | "upsertAgent" | "removeAgent" | "updateTransport" | "updateWechat">
{
  constructor(private readonly config: AppConfig) {}

  async save(config: AppConfig): Promise<void> {
    this.config.transport = { ...config.transport };
    this.config.logging = { ...config.logging };
    this.config.wechat = { ...config.wechat };
    this.config.agents = Object.fromEntries(Object.entries(config.agents).map(([name, agent]) => [name, { ...agent }]));
    this.config.workspaces = Object.fromEntries(
      Object.entries(config.workspaces).map(([name, workspace]) => [name, { ...workspace }]),
    );
  }

  async upsertWorkspace(name: string, cwd: string, description?: string): Promise<AppConfig> {
    this.config.workspaces[name] = {
      cwd,
      ...(description ? { description } : {}),
    };
    return this.config;
  }

  async removeWorkspace(name: string): Promise<AppConfig> {
    delete this.config.workspaces[name];
    return this.config;
  }

  async upsertAgent(name: string, agent: AppConfig["agents"][string]): Promise<AppConfig> {
    this.config.agents[name] = agent;
    return this.config;
  }

  async removeAgent(name: string): Promise<AppConfig> {
    delete this.config.agents[name];
    return this.config;
  }

  async updateTransport(transport: Partial<AppConfig["transport"]>): Promise<AppConfig> {
    this.config.transport = {
      ...this.config.transport,
      ...transport,
    };
    return this.config;
  }

  async updateWechat(wechat: Partial<AppConfig["wechat"]>): Promise<AppConfig> {
    this.config.wechat = {
      ...this.config.wechat,
      ...wechat,
    };
    return this.config;
  }
}

export function createTransport(): SessionTransport {
  return {
    ensureSession: mock(async (_session: ResolvedSession) => {}),
    prompt: mock(async (session: ResolvedSession, text: string) => ({
      text: `agent:${session.alias}:${text}`,
    })),
    setMode: mock(async (_session: ResolvedSession, _modeId: string) => {}),
    cancel: mock(async () => ({
      cancelled: true,
      message: "cancelled",
    })),
    hasSession: mock(async () => true),
    updatePermissionPolicy: mock(async (_policy) => {}),
  };
}

export function getPromptMock(transport: SessionTransport) {
  return transport.prompt as ReturnType<typeof mock>;
}

export function getCancelMock(transport: SessionTransport) {
  return transport.cancel as ReturnType<typeof mock>;
}

export function getSetModeMock(transport: SessionTransport) {
  return transport.setMode as ReturnType<typeof mock>;
}

export function basename(path: string): string {
  return path.split(/[\/]/).at(-1)!;
}

export function createLogger(events: string[]): AppLogger {
  return {
    debug: async (event, _message, context) => {
      events.push(`DEBUG ${event} ${JSON.stringify(context ?? {})}`);
    },
    info: async (event, _message, context) => {
      events.push(`INFO ${event} ${JSON.stringify(context ?? {})}`);
    },
    error: async (event, _message, context) => {
      events.push(`ERROR ${event} ${JSON.stringify(context ?? {})}`);
    },
    cleanup: async () => {},
  };
}

export type SessionAgentCommandResolver = (session: ResolvedSession) => Promise<string | undefined>;

export { SessionService, createEmptyState };

export function getUpdatePermissionPolicyMock(transport: SessionTransport & { updatePermissionPolicy?: unknown }) {
  return transport.updatePermissionPolicy as ReturnType<typeof mock>;
}
