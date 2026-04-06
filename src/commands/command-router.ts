
import type { AppConfig } from "../config/types";
import type { AppLogger } from "../logging/app-logger";
import { createNoopAppLogger } from "../logging/app-logger";
import type { SessionService } from "../sessions/session-service";
import type { SessionTransport } from "../transport/types";
import type { ResolvedSession } from "../transport/types";
import { resolveSessionAgentCommandFromIndex, type SessionAgentCommandResolver } from "../transport/acpx-session-index";
import { PromptCommandError } from "../transport/prompt-output";
import { parseCommand } from "./parse-command";
import { handlePermissionAutoSet, handlePermissionAutoStatus, handlePermissionModeSet, handlePermissionStatus } from "./handlers/permission-handler";
import { handleConfigSet, handleConfigShow } from "./handlers/config-handler";
import {
  handleCancel,
  handleModeSet,
  handleModeShow,
  handlePrompt,
  handleReplyModeReset,
  handleReplyModeSet,
  handleReplyModeShow,
  handleSessionAttach,
  handleSessionNew,
  handleSessionReset,
  handleSessions,
  handleSessionShortcut,
  handleSessionUse,
  handleStatus,
  type SessionHandlerContext,
} from "./handlers/session-handler";
import {
  isPartialPromptOutputError,
  summarizeTransportDiagnostic,
  summarizeTransportDiagnosticTail,
  summarizeTransportError,
  summarizeTransportNdjson,
} from "./transport-diagnostics";
import { handleHelp } from "./handlers/help-handler";
import { handleAgents, handleAgentAdd, handleAgentRemove } from "./handlers/agent-handler";
import { handleWorkspaces, handleWorkspaceCreate, handleWorkspaceRemove } from "./handlers/workspace-handler";
import { handleSessionShortcutCommand } from "./handlers/session-shortcut-handler";
import { renderSessionCreationError, renderSessionCreationVerificationError, renderTransportError, tryRecoverMissingSession } from "./handlers/session-recovery-handler";
import { handleSessionResetCommand } from "./handlers/session-reset-handler";
import type {
  CommandRouterContext,
  RouterResponse,
  SessionInteractionOps,
  SessionLifecycleOps,
  SessionRecoveryOps,
  SessionRenderRecoveryOps,
  SessionResetOps,
  SessionShortcutOps,
  WritableConfigStore,
} from "./router-types";

export class CommandRouter {
  private readonly logger: AppLogger;

  constructor(
    private readonly sessions: SessionService,
    private readonly transport: SessionTransport,
    private readonly config?: AppConfig,
    private readonly configStore?: WritableConfigStore,
    logger?: AppLogger,
    private readonly resolveSessionAgentCommand: SessionAgentCommandResolver = resolveSessionAgentCommandFromIndex,
  ) {
    this.logger = logger ?? createNoopAppLogger();
  }

  async handle(chatKey: string, input: string, reply?: (text: string) => Promise<void>): Promise<RouterResponse> {
    const startedAt = Date.now();
    const command = parseCommand(input);
    await this.logger.debug("command.parsed", "parsed inbound command", {
      chatKey,
      kind: command.kind,
    });

    return await this.executeCommand(chatKey, command.kind, startedAt, async () => {
      switch (command.kind) {
        case "invalid":
          return {
            text: [
              "无法识别的命令格式。",
              "",
              "正确的会话创建格式：",
              "/session new <别名> --agent <Agent名> --ws <工作区名>",
              "",
              "例如：",
              "/session new demo --agent claude --ws weacpx",
            ].join("\n"),
          };
        case "help":
          return handleHelp(command.topic);
        case "agents":
          return handleAgents(this.createHandlerContext());
        case "agent.add":
          return await handleAgentAdd(this.createHandlerContext(), command.template);
        case "agent.rm":
          return await handleAgentRemove(this.createHandlerContext(), command.name);
        case "permission.status":
          return handlePermissionStatus(this.createHandlerContext(), "当前权限模式：");
        case "permission.mode.set":
          return await handlePermissionModeSet(this.createHandlerContext(), command.mode);
        case "permission.auto.status":
          return handlePermissionAutoStatus(this.createHandlerContext(), "当前非交互策略：");
        case "permission.auto.set":
          return await handlePermissionAutoSet(this.createHandlerContext(), command.policy);
        case "config.show":
          return handleConfigShow(this.createHandlerContext());
        case "config.set":
          return await handleConfigSet(this.createHandlerContext(), command.path, command.value);
        case "workspaces":
          return handleWorkspaces(this.createHandlerContext());
        case "workspace.new":
          return await handleWorkspaceCreate(this.createHandlerContext(), command.name, command.cwd);
        case "workspace.rm":
          return await handleWorkspaceRemove(this.createHandlerContext(), command.name);
        case "sessions":
          return await handleSessions(this.createSessionHandlerContext(), chatKey);
        case "session.new":
          return await handleSessionNew(
            this.createSessionHandlerContext(),
            chatKey,
            command.alias,
            command.agent,
            command.workspace,
          );
        case "session.shortcut":
          return await handleSessionShortcut(this.createSessionHandlerContext(), chatKey, command.agent, command, false);
        case "session.shortcut.new":
          return await handleSessionShortcut(this.createSessionHandlerContext(), chatKey, command.agent, command, true);
        case "session.attach":
          return await handleSessionAttach(
            this.createSessionHandlerContext(),
            chatKey,
            command.alias,
            command.agent,
            command.workspace,
            command.transportSession,
          );
        case "session.use":
          return await handleSessionUse(this.createSessionHandlerContext(), chatKey, command.alias);
        case "mode.show":
          return await handleModeShow(this.createSessionHandlerContext(), chatKey);
        case "mode.set":
          return await handleModeSet(this.createSessionHandlerContext(), chatKey, command.modeId);
        case "replymode.show":
          return await handleReplyModeShow(this.createSessionHandlerContext(), chatKey);
        case "replymode.set":
          return await handleReplyModeSet(this.createSessionHandlerContext(), chatKey, command.replyMode);
        case "replymode.reset":
          return await handleReplyModeReset(this.createSessionHandlerContext(), chatKey);
        case "status":
          return await handleStatus(this.createSessionHandlerContext(), chatKey);
        case "cancel":
          return await handleCancel(this.createSessionHandlerContext(), chatKey);
        case "session.reset":
          return await handleSessionReset(this.createSessionHandlerContext(), chatKey);
        case "prompt":
          return await handlePrompt(this.createSessionHandlerContext(), chatKey, command.text, reply);
      }
    });
  }

  async clearSession(chatKey: string): Promise<void> {
    await handleSessionResetCommand(this.createHandlerContext(), this.createSessionResetOps(), chatKey);
  }

  private createHandlerContext(): CommandRouterContext {
    return {
      sessions: this.sessions,
      transport: this.transport,
      config: this.config,
      configStore: this.configStore,
      logger: this.logger,
      replaceConfig: (updated) => this.replaceConfig(updated),
    };
  }

  private createSessionHandlerContext(): SessionHandlerContext {
    return {
      ...this.createHandlerContext(),
      lifecycle: this.createSessionLifecycleOps(),
      interaction: this.createSessionInteractionOps(),
      recovery: this.createSessionRenderRecoveryOps(),
    };
  }


  private createSessionLifecycleOps(): SessionLifecycleOps {
    return {
      resolveSession: (alias, agent, workspace, transportSession) =>
        this.sessions.resolveSession(alias, agent, workspace, transportSession),
      ensureTransportSession: (session) => this.ensureTransportSession(session),
      checkTransportSession: (session) => this.checkTransportSession(session),
      handleSessionShortcut: (chatKey, agent, target, createNew) =>
        handleSessionShortcutCommand(this.createHandlerContext(), this.createSessionShortcutOps(), chatKey, agent, target, createNew),
      resetCurrentSession: (chatKey) => handleSessionResetCommand(this.createHandlerContext(), this.createSessionResetOps(), chatKey),
      refreshSessionTransportAgentCommand: (alias) => this.refreshSessionTransportAgentCommand(alias),
    };
  }

  private createSessionInteractionOps(): SessionInteractionOps {
    return {
      setModeTransportSession: (session, modeId) => this.setModeTransportSession(session, modeId),
      cancelTransportSession: (session) => this.cancelTransportSession(session),
      promptTransportSession: (session, text, reply) => this.promptTransportSession(session, text, reply),
    };
  }

  private createSessionRenderRecoveryOps(): SessionRenderRecoveryOps {
    return {
      renderSessionCreationError: (session, error) => renderSessionCreationError(session, error),
      renderSessionCreationVerificationError: (session) => renderSessionCreationVerificationError(session),
      tryRecoverMissingSession: (session, error) => tryRecoverMissingSession(this.createSessionRecoveryOps(), session, error),
      renderTransportError: (session, error) => renderTransportError(session, error),
    };
  }

  private createSessionResetOps(): SessionResetOps {
    return {
      ensureTransportSession: (session) => this.ensureTransportSession(session),
      checkTransportSession: (session) => this.checkTransportSession(session),
      resolveSession: (alias, agent, workspace, transportSession) =>
        this.sessions.resolveSession(alias, agent, workspace, transportSession),
      refreshSessionTransportAgentCommand: (alias) => this.refreshSessionTransportAgentCommand(alias),
      now: () => Date.now(),
    };
  }

  private createSessionRecoveryOps(): SessionRecoveryOps {
    return {
      resolveSessionAgentCommand: (session) => this.resolveSessionAgentCommand(session),
      setSessionTransportAgentCommand: (alias, command) => this.sessions.setSessionTransportAgentCommand(alias, command),
      getSession: (alias) => this.sessions.getSession(alias),
    };
  }

  private createSessionShortcutOps(): SessionShortcutOps {
    return {
      resolveSession: (alias, agent, workspace, transportSession) =>
        this.sessions.resolveSession(alias, agent, workspace, transportSession),
      ensureTransportSession: (session) => this.ensureTransportSession(session),
      checkTransportSession: (session) => this.checkTransportSession(session),
      refreshSessionTransportAgentCommand: (alias) => this.refreshSessionTransportAgentCommand(alias),
    };
  }

  private replaceConfig(updated: AppConfig): void {
    if (!this.config) {
      return;
    }

    // Replace reference to prevent mutation of caller's object
    this.config.transport = { ...updated.transport };
    this.config.logging = { ...updated.logging };
    this.config.wechat = { ...updated.wechat };
    this.config.agents = { ...updated.agents };
    this.config.workspaces = { ...updated.workspaces };
  }



  private async executeCommand(
    chatKey: string,
    kind: string,
    startedAt: number,
    operation: () => Promise<RouterResponse>,
  ): Promise<RouterResponse> {
    try {
      const response = await operation();
      await this.logger.info("command.completed", "completed command handling", {
        chatKey,
        kind,
        durationMs: Date.now() - startedAt,
      });
      return response;
    } catch (error) {
      await this.logger.error("command.failed", "command handling failed", {
        chatKey,
        kind,
        durationMs: Date.now() - startedAt,
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  }

  private async ensureTransportSession(session: ResolvedSession): Promise<void> {
    await this.measureTransportCall("ensure_session", session, () => this.transport.ensureSession(session));
  }


  private async checkTransportSession(session: ResolvedSession): Promise<boolean> {
    return await this.measureTransportCall("has_session", session, () => this.transport.hasSession(session));
  }

  private async promptTransportSession(session: ResolvedSession, text: string, reply?: (text: string) => Promise<void>) {
    return await this.measureTransportCall("prompt", session, () => this.transport.prompt(session, text, reply));
  }

  private async setModeTransportSession(session: ResolvedSession, modeId: string) {
    return await this.measureTransportCall("set_mode", session, () => this.transport.setMode(session, modeId));
  }

  private async cancelTransportSession(session: ResolvedSession) {
    return await this.measureTransportCall("cancel", session, () => this.transport.cancel(session));
  }

  private async refreshSessionTransportAgentCommand(alias: string): Promise<void> {
    const session = await this.sessions.getSession(alias);
    if (!session) {
      return;
    }

    const transportAgentCommand = await this.resolveSessionAgentCommand(session);
    if (!transportAgentCommand) {
      return;
    }

    await this.sessions.setSessionTransportAgentCommand(alias, transportAgentCommand);
  }


  private async measureTransportCall<T>(
    operation: string,
    session: ResolvedSession,
    callback: () => Promise<T>,
  ): Promise<T> {
    const startedAt = Date.now();
    try {
      const result = await callback();
      await this.logger.info(`transport.${operation}`, "transport operation completed", {
        operation,
        agent: session.agent,
        workspace: session.workspace,
        alias: session.alias,
        durationMs: Date.now() - startedAt,
      });
      return result;
    } catch (error) {
      const diagnosticContext = error instanceof PromptCommandError
        ? {
            exitCode: error.exitCode,
            stdoutPreview: summarizeTransportDiagnostic(error.stdout),
            stdoutTailPreview: summarizeTransportDiagnosticTail(error.stdout),
            stdoutLength: error.stdout.length,
            ...summarizeTransportNdjson(error.stdout, "stdout"),
            stderrPreview: summarizeTransportDiagnostic(error.stderr),
            stderrTailPreview: summarizeTransportDiagnosticTail(error.stderr),
            stderrLength: error.stderr.length,
            ...summarizeTransportNdjson(error.stderr, "stderr"),
          }
        : {};
      await this.logger.error(`transport.${operation}.failed`, "transport operation failed", {
        operation,
        agent: session.agent,
        workspace: session.workspace,
        alias: session.alias,
        durationMs: Date.now() - startedAt,
        error: error instanceof Error ? error.message : String(error),
        ...diagnosticContext,
      });
      throw error;
    }
  }
}
