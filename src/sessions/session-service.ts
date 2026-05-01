import { resolveAgentCommand } from "../config/resolve-agent-command";
import type { AppConfig, WechatReplyMode } from "../config/types";
import { AsyncMutex } from "../orchestration/async-mutex";
import type { StateStore } from "../state/state-store";
import type { AppState, LogicalSession } from "../state/types";
import type { ResolvedSession } from "../transport/types";

interface SessionListItem {
  alias: string;
  agent: string;
  workspace: string;
  isCurrent: boolean;
}

interface SessionServiceOptions {
  stateMutex?: AsyncMutex;
}

export class SessionService {
  private readonly stateMutex: AsyncMutex;

  constructor(
    private readonly config: AppConfig,
    private readonly stateStore: Pick<StateStore, "save">,
    private readonly state: AppState,
    options: SessionServiceOptions = {},
  ) {
    this.stateMutex = options.stateMutex ?? new AsyncMutex();
  }

  async createSession(alias: string, agent: string, workspace: string): Promise<ResolvedSession> {
    return await this.createLogicalSession(alias, agent, workspace, `${workspace}:${alias}`);
  }

  resolveSession(alias: string, agent: string, workspace: string, transportSession: string): ResolvedSession {
    this.validateSession(alias, agent, workspace);
    return this.toResolvedSession({
      alias,
      agent,
      workspace,
      transport_session: transportSession,
      transport_agent_command: this.state.sessions[alias]?.transport_agent_command,
      created_at: this.state.sessions[alias]?.created_at ?? new Date().toISOString(),
      last_used_at: new Date().toISOString(),
    });
  }

  async attachSession(
    alias: string,
    agent: string,
    workspace: string,
    transportSession: string,
    transportAgentCommand?: string,
  ): Promise<ResolvedSession> {
    return await this.createLogicalSession(alias, agent, workspace, transportSession, transportAgentCommand);
  }

  async getSession(alias: string): Promise<ResolvedSession | null> {
    const session = this.state.sessions[alias];
    if (!session) {
      return null;
    }

    return this.toResolvedSession(session);
  }

  async getPreferredSessionForTransport(transportSession: string): Promise<ResolvedSession | null> {
    const matches = Object.values(this.state.sessions)
      .filter((session) => session.transport_session === transportSession)
      .sort((left, right) => right.last_used_at.localeCompare(left.last_used_at));

    const expectedAlias = transportSession.split(":").at(-1);
    const expectedWorkspace = transportSession.split(":")[0];
    const preferred =
      matches.find(
        (session) => session.alias === expectedAlias && session.workspace === expectedWorkspace,
      ) ?? matches[0];
    return preferred ? this.toResolvedSession(preferred) : null;
  }

  async useSession(chatKey: string, alias: string): Promise<void> {
    await this.mutate(async () => {
      const session = this.state.sessions[alias];
      if (!session) {
        throw new Error(`session "${alias}" does not exist`);
      }

      session.last_used_at = new Date().toISOString();
      this.state.chat_contexts[chatKey] = { current_session: alias };
      await this.persist();
    });
  }

  async setCurrentSessionMode(chatKey: string, modeId: string | undefined): Promise<void> {
    await this.mutate(async () => {
      const currentAlias = this.state.chat_contexts[chatKey]?.current_session;
      if (!currentAlias) {
        throw new Error("no current session selected");
      }

      const session = this.state.sessions[currentAlias];
      if (!session) {
        throw new Error("no current session selected");
      }

      const normalizedModeId = modeId?.trim();
      if (normalizedModeId) {
        session.mode_id = normalizedModeId;
      } else {
        delete session.mode_id;
      }

      session.last_used_at = new Date().toISOString();
      await this.persist();
    });
  }

  async setCurrentSessionReplyMode(chatKey: string, replyMode: "stream" | "final" | "verbose" | undefined): Promise<void> {
    await this.mutate(async () => {
      const currentAlias = this.state.chat_contexts[chatKey]?.current_session;
      if (!currentAlias) {
        throw new Error("no current session selected");
      }

      const session = this.state.sessions[currentAlias];
      if (!session) {
        throw new Error("no current session selected");
      }

      if (replyMode) {
        session.reply_mode = replyMode;
      } else {
        delete session.reply_mode;
      }

      session.last_used_at = new Date().toISOString();
      await this.persist();
    });
  }

  async getCurrentSession(chatKey: string): Promise<ResolvedSession | null> {
    return await this.mutate(async () => {
      const currentAlias = this.state.chat_contexts[chatKey]?.current_session;
      if (!currentAlias) {
        return null;
      }

      const session = this.state.sessions[currentAlias];
      if (!session) {
        return null;
      }

      session.last_used_at = new Date().toISOString();
      await this.persist();
      return this.toResolvedSession(session);
    });
  }

  async listSessions(chatKey: string): Promise<SessionListItem[]> {
    const currentAlias = this.state.chat_contexts[chatKey]?.current_session;
    return Object.values(this.state.sessions).map((session) => ({
      alias: session.alias,
      agent: session.agent,
      workspace: session.workspace,
      isCurrent: session.alias === currentAlias,
    }));
  }

  countAliasesSharingTransport(transportSession: string, excludeAlias?: string): number {
    let count = 0;
    for (const session of Object.values(this.state.sessions)) {
      if (session.transport_session !== transportSession) {
        continue;
      }
      if (excludeAlias !== undefined && session.alias === excludeAlias) {
        continue;
      }
      count += 1;
    }
    return count;
  }

  async removeSession(alias: string): Promise<{ wasActive: boolean }> {
    return await this.mutate(async () => {
      const session = this.state.sessions[alias];
      if (!session) {
        throw new Error(`session "${alias}" does not exist`);
      }

      const wasActive = Object.values(this.state.chat_contexts).some(
        (ctx) => ctx.current_session === alias,
      );

      delete this.state.sessions[alias];

      for (const [chatKey, ctx] of Object.entries(this.state.chat_contexts)) {
        if (ctx.current_session === alias) {
          delete this.state.chat_contexts[chatKey];
        }
      }

      await this.persist();
      return { wasActive };
    });
  }

  private toResolvedSession(session: LogicalSession): ResolvedSession {
    const agentConfig = this.config.agents[session.agent];
    if (!agentConfig) {
      throw new Error(
        `session "${session.alias}" references agent "${session.agent}", but that agent is no longer registered`,
      );
    }

    const workspaceConfig = this.config.workspaces[session.workspace];
    if (!workspaceConfig) {
      throw new Error(
        `session "${session.alias}" references workspace "${session.workspace}", but that workspace is no longer registered`,
      );
    }

    return {
      alias: session.alias,
      agent: session.agent,
      agentCommand: session.transport_agent_command ?? resolveAgentCommand(agentConfig.driver, agentConfig.command),
      workspace: session.workspace,
      transportSession: session.transport_session,
      modeId: session.mode_id,
      replyMode: session.reply_mode,
      cwd: workspaceConfig.cwd,
    };
  }

  async setSessionTransportAgentCommand(alias: string, transportAgentCommand: string | undefined): Promise<void> {
    await this.mutate(async () => {
      const session = this.state.sessions[alias];
      if (!session) {
        throw new Error(`session "${alias}" does not exist`);
      }

      const normalized = transportAgentCommand?.trim();
      if (normalized) {
        session.transport_agent_command = normalized;
      } else {
        delete session.transport_agent_command;
      }

      session.last_used_at = new Date().toISOString();
      await this.persist();
    });
  }

  private async mutate<T>(critical: () => Promise<T>): Promise<T> {
    return await this.stateMutex.run(critical);
  }

  private async persist(): Promise<void> {
    await this.stateStore.save(this.state);
  }

  private async createLogicalSession(
    alias: string,
    agent: string,
    workspace: string,
    transportSession: string,
    transportAgentCommand?: string,
  ): Promise<ResolvedSession> {
    return await this.mutate(async () => {
      this.validateSession(alias, agent, workspace);
      if (this.state.orchestration.externalCoordinators[transportSession]) {
        throw new Error(`transport session "${transportSession}" conflicts with an external coordinator`);
      }
      const existingSession = this.state.sessions[alias];
      const now = new Date().toISOString();
      const normalizedTransportAgentCommand = transportAgentCommand?.trim();
      const session: LogicalSession = {
        alias,
        agent,
        workspace,
        transport_session: transportSession,
        ...(normalizedTransportAgentCommand
          ? { transport_agent_command: normalizedTransportAgentCommand }
          : existingSession?.transport_agent_command
            ? { transport_agent_command: existingSession.transport_agent_command }
            : {}),
        mode_id: existingSession?.mode_id,
        reply_mode: existingSession?.reply_mode,
        created_at: existingSession?.created_at ?? now,
        last_used_at: now,
      };

      this.state.sessions[alias] = session;
      await this.persist();
      return this.toResolvedSession(session);
    });
  }

  private validateSession(alias: string, agent: string, workspace: string): void {
    if (alias.trim().length === 0) {
      throw new Error("session alias must be a non-empty string");
    }

    if (agent.trim().length === 0) {
      throw new Error("agent must be a non-empty string");
    }

    if (workspace.trim().length === 0) {
      throw new Error("workspace must be a non-empty string");
    }

    if (!this.config.workspaces[workspace]) {
      throw new Error(`工作区「${workspace}」未注册`);
    }

    if (!this.config.agents[agent]) {
      throw new Error(`Agent「${agent}」未注册`);
    }
  }
}
