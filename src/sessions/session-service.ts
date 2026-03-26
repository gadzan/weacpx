import { resolveAgentCommand } from "../config/resolve-agent-command";
import type { AppConfig } from "../config/types";
import type { StateStore } from "../state/state-store";
import type { AppState, LogicalSession } from "../state/types";
import type { ResolvedSession } from "../transport/types";

interface SessionListItem {
  alias: string;
  agent: string;
  workspace: string;
  isCurrent: boolean;
}

export class SessionService {
  constructor(
    private readonly config: AppConfig,
    private readonly stateStore: Pick<StateStore, "save">,
    private readonly state: AppState,
  ) {}

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
      created_at: this.state.sessions[alias]?.created_at ?? new Date().toISOString(),
      last_used_at: new Date().toISOString(),
    });
  }

  async attachSession(
    alias: string,
    agent: string,
    workspace: string,
    transportSession: string,
  ): Promise<ResolvedSession> {
    return await this.createLogicalSession(alias, agent, workspace, transportSession);
  }

  async useSession(chatKey: string, alias: string): Promise<void> {
    const session = this.state.sessions[alias];
    if (!session) {
      throw new Error(`session "${alias}" does not exist`);
    }

    session.last_used_at = new Date().toISOString();
    this.state.chat_contexts[chatKey] = { current_session: alias };
    await this.persist();
  }

  async getCurrentSession(chatKey: string): Promise<ResolvedSession | null> {
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

  private toResolvedSession(session: LogicalSession): ResolvedSession {
    const agentConfig = this.config.agents[session.agent]!;
    return {
      alias: session.alias,
      agent: session.agent,
      agentCommand: resolveAgentCommand(agentConfig.driver, agentConfig.command),
      workspace: session.workspace,
      transportSession: session.transport_session,
      cwd: this.config.workspaces[session.workspace]!.cwd,
    };
  }

  private async persist(): Promise<void> {
    await this.stateStore.save(this.state);
  }

  private async createLogicalSession(
    alias: string,
    agent: string,
    workspace: string,
    transportSession: string,
  ): Promise<ResolvedSession> {
    this.validateSession(alias, agent, workspace);
    const existingSession = this.state.sessions[alias];
    const now = new Date().toISOString();
    const session: LogicalSession = {
      alias,
      agent,
      workspace,
      transport_session: transportSession,
      created_at: existingSession?.created_at ?? now,
      last_used_at: now,
    };

    this.state.sessions[alias] = session;
    await this.persist();
    return this.toResolvedSession(session);
  }

  private validateSession(alias: string, agent: string, workspace: string): void {
    void alias;
    if (!this.config.workspaces[workspace]) {
      throw new Error(`workspace "${workspace}" is not registered`);
    }

    if (!this.config.agents[agent]) {
      throw new Error(`agent "${agent}" is not registered`);
    }
  }
}
