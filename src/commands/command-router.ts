
import type { AppConfig } from "../config/types";
import type { AppLogger } from "../logging/app-logger";
import { createNoopAppLogger } from "../logging/app-logger";
import type { SessionService } from "../sessions/session-service";
import type { ReplyQuotaContext, SessionTransport } from "../transport/types";
import type { ResolvedSession } from "../transport/types";
import type { QuotaManager } from "../weixin/messaging/quota-manager.js";
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
  handleSessionRemove,
  handleSessionReset,
  handleSessions,
  handleSessionShortcut,
  handleSessionUse,
  handleStatus,
  type SessionHandlerContext,
} from "./handlers/session-handler";
import {
  handleDelegateRequest,
  handleGroupCancel,
  handleGroupCreate,
  handleGroupDelegate,
  handleGroupGet,
  handleGroupList,
  handleTaskApprove,
  handleTaskCancel,
  handleTaskGet,
  handleTaskList,
  handleTaskReject,
  handleTasksClean,
} from "./handlers/orchestration-handler";
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
import { autoInstallOptionalDep as defaultAutoInstall } from "../recovery/auto-install-optional-dep";
import { discoverParentPackagePaths as defaultDiscoverPaths } from "../recovery/discover-parent-package-paths";
import { AutoInstallFailedError, MissingOptionalDepError } from "../recovery/errors";
import type { EnsureSessionProgress } from "../transport/types";
import { translateAcpxNote } from "./translate-acpx-note";
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
  OrchestrationRouterOps,
  WritableConfigStore,
} from "./router-types";

type AutoInstallFn = typeof defaultAutoInstall;
type DiscoverPathsFn = typeof defaultDiscoverPaths;

export class CommandRouter {
  private readonly logger: AppLogger;
  private autoInstall: AutoInstallFn = defaultAutoInstall;
  private discoverPaths: DiscoverPathsFn = defaultDiscoverPaths;

  __setAutoInstallForTest(fn: AutoInstallFn): void {
    this.autoInstall = fn;
  }

  __setDiscoverPathsForTest(fn: DiscoverPathsFn): void {
    this.discoverPaths = fn;
  }

  constructor(
    private readonly sessions: SessionService,
    private readonly transport: SessionTransport,
    private readonly config?: AppConfig,
    private readonly configStore?: WritableConfigStore,
    logger?: AppLogger,
    private readonly resolveSessionAgentCommand: SessionAgentCommandResolver = resolveSessionAgentCommandFromIndex,
    private readonly orchestration?: OrchestrationRouterOps,
    private readonly quota?: QuotaManager,
  ) {
    this.logger = logger ?? createNoopAppLogger();
  }

  async handle(
    chatKey: string,
    input: string,
    reply?: (text: string) => Promise<void>,
    replyContextToken?: string,
    accountId?: string,
  ): Promise<RouterResponse> {
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
            this.createSessionHandlerContext(reply),
            chatKey,
            command.alias,
            command.agent,
            command.workspace,
          );
        case "session.shortcut":
          return await handleSessionShortcut(this.createSessionHandlerContext(reply), chatKey, command.agent, command, false);
        case "session.shortcut.new":
          return await handleSessionShortcut(this.createSessionHandlerContext(reply), chatKey, command.agent, command, true);
        case "session.attach":
          return await handleSessionAttach(
            this.createSessionHandlerContext(reply),
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
          return await handleSessionReset(this.createSessionHandlerContext(reply), chatKey);
        case "session.rm":
          return await handleSessionRemove(this.createSessionHandlerContext(), chatKey, command.alias);
        case "groups":
          return await handleGroupList(this.createHandlerContext(), chatKey, command.filter);
        case "group.new":
          return await handleGroupCreate(this.createHandlerContext(), chatKey, command.title);
        case "group.get":
          return await handleGroupGet(this.createHandlerContext(), chatKey, command.groupId);
        case "group.cancel":
          return await handleGroupCancel(this.createHandlerContext(), chatKey, command.groupId);
        case "group.delegate":
          return await handleGroupDelegate(
            this.createHandlerContext(),
            chatKey,
            command.groupId,
            command.targetAgent,
            command.task,
            command.role,
            replyContextToken,
            accountId,
          );
        case "delegate.request":
          return await handleDelegateRequest(
            this.createHandlerContext(),
            chatKey,
            command.targetAgent,
            command.task,
            command.role,
            command.groupId,
            replyContextToken,
            accountId,
          );
        case "tasks":
          return await handleTaskList(this.createHandlerContext(), chatKey, command.filter);
        case "tasks.clean":
          return await handleTasksClean(this.createHandlerContext(), chatKey);
        case "task.get":
          return await handleTaskGet(this.createHandlerContext(), chatKey, command.taskId);
        case "task.approve":
          return await handleTaskApprove(this.createHandlerContext(), chatKey, command.taskId);
        case "task.reject":
          return await handleTaskReject(this.createHandlerContext(), chatKey, command.taskId);
        case "task.cancel":
          return await handleTaskCancel(this.createHandlerContext(), chatKey, command.taskId);
        case "prompt":
          return await handlePrompt(
            this.createSessionHandlerContext(),
            chatKey,
            command.text,
            reply,
            replyContextToken,
            accountId,
          );
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
      orchestration: this.orchestration,
      config: this.config,
      configStore: this.configStore,
      logger: this.logger,
      replaceConfig: (updated) => this.replaceConfig(updated),
      ...(this.quota ? { quota: this.quota } : {}),
    };
  }

  private createSessionHandlerContext(reply?: (text: string) => Promise<void>): SessionHandlerContext {
    return {
      ...this.createHandlerContext(),
      lifecycle: this.createSessionLifecycleOps(reply),
      interaction: this.createSessionInteractionOps(),
      recovery: this.createSessionRenderRecoveryOps(),
    };
  }


  private createSessionLifecycleOps(reply?: (text: string) => Promise<void>): SessionLifecycleOps {
    return {
      resolveSession: (alias, agent, workspace, transportSession) =>
        this.sessions.resolveSession(alias, agent, workspace, transportSession),
      ensureTransportSession: (session, replyOverride) => this.ensureTransportSession(session, replyOverride ?? reply),
      checkTransportSession: (session) => this.checkTransportSession(session),
      handleSessionShortcut: async (chatKey, agent, target, createNew, replyOverride) => {
        try {
          return await handleSessionShortcutCommand(this.createHandlerContext(), this.createSessionShortcutOps(replyOverride ?? reply), chatKey, agent, target, createNew);
        } catch (err) {
          if (err instanceof AutoInstallFailedError) {
            // Find a dummy session for rendering — use agent/workspace as best-effort
            const session = this.sessions.resolveSession(`${agent}`, agent, target.workspace ?? "", `${agent}`);
            return renderSessionCreationError(session, err);
          }
          throw err;
        }
      },
      resetCurrentSession: (chatKey, replyOverride) => handleSessionResetCommand(this.createHandlerContext(), this.createSessionResetOps(replyOverride ?? reply), chatKey),
      refreshSessionTransportAgentCommand: (alias) => this.refreshSessionTransportAgentCommand(alias),
    };
  }

  private createSessionInteractionOps(): SessionInteractionOps {
    return {
      setModeTransportSession: (session, modeId) => this.setModeTransportSession(session, modeId),
      cancelTransportSession: (session) => this.cancelTransportSession(session),
      promptTransportSession: (session, text, reply, replyContext) =>
        this.promptTransportSession(session, text, reply, replyContext),
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

  private createSessionResetOps(reply?: (text: string) => Promise<void>): SessionResetOps {
    return {
      ensureTransportSession: (session, replyOverride) => this.ensureTransportSession(session, replyOverride ?? reply),
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

  private createSessionShortcutOps(reply?: (text: string) => Promise<void>): SessionShortcutOps {
    return {
      resolveSession: (alias, agent, workspace, transportSession) =>
        this.sessions.resolveSession(alias, agent, workspace, transportSession),
      ensureTransportSession: (session, replyOverride) => this.ensureTransportSession(session, replyOverride ?? reply),
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

  private async ensureTransportSession(
    session: ResolvedSession,
    reply?: (text: string) => Promise<void>,
  ): Promise<void> {
    const attemptSession = (operation: string): Promise<void> => {
      const { handler, dispose } = this.createProgressHandler(session, reply);
      return this.measureTransportCall(operation, session, () =>
        this.transport.ensureSession(session, handler),
      ).finally(dispose);
    };

    try {
      await attemptSession("ensure_session");
    } catch (err) {
      if (!(err instanceof MissingOptionalDepError)) throw err;
      await reply?.(`📦 检测到缺失依赖 \`${err.package}\`，正在自动安装…`);

      const paths = await this.discoverPaths(err.package, err.parentPackagePath, {
        cwd: session.cwd,
      });
      const result = await this.autoInstall(err.package, paths, {
        verify: async () => {
          await reply?.(`🔄 安装完成，正在验证会话启动…`);
          try {
            await attemptSession("ensure_session.verify");
            return true;
          } catch (retryErr) {
            if (retryErr instanceof MissingOptionalDepError) return false;
            throw retryErr;
          }
        },
      });

      if (!result.ok) {
        throw new AutoInstallFailedError(err, result.errors, result.logPath);
      }
    }
  }

  private createProgressHandler(
    session: ResolvedSession,
    reply?: (text: string) => Promise<void>,
  ): { handler: (progress: EnsureSessionProgress) => void; dispose: () => void } {
    const startedAt = Date.now();
    let lastMessageAt = 0;
    const DEBOUNCE_MS = 3000;
    const HEARTBEAT_MS = 30_000;
    // Suppression window smaller than the interval: a message sent within the
    // last HEARTBEAT_SUPPRESS_MS silences the next heartbeat. Using `<
    // HEARTBEAT_MS` here would skip the first heartbeat at t=30s because the
    // `spawn` message near t=0 falls just inside a 30s window due to timer jitter.
    const HEARTBEAT_SUPPRESS_MS = 10_000;

    const sendHeartbeat = (): void => {
      if (!reply) return;
      const now = Date.now();
      if (now - lastMessageAt < HEARTBEAT_SUPPRESS_MS) return;
      const elapsed = Math.floor((now - startedAt) / 1000);
      void reply(`⏳ \`${session.agent}\` 仍在准备中…（已等待 ${elapsed}s）`).catch(() => {});
      lastMessageAt = now;
    };
    const heartbeatTimer = reply
      ? setInterval(sendHeartbeat, HEARTBEAT_MS)
      : undefined;

    const handler = (progress: EnsureSessionProgress): void => {
      if (!reply) return;
      const now = Date.now();
      if (typeof progress === "string") {
        if (progress === "spawn") {
          void reply(`🚀 正在启动 \`${session.agent}\`…`).catch(() => {});
          lastMessageAt = now;
        } else if (progress === "initializing") {
          if (now - lastMessageAt >= DEBOUNCE_MS) {
            const elapsed = Math.floor((now - startedAt) / 1000);
            void reply(`🔧 \`${session.agent}\` 初始化中…（已等待 ${elapsed}s）`).catch(() => {});
            lastMessageAt = now;
          }
        }
        return;
      }
      // progress.kind === "note"
      if (now - lastMessageAt < DEBOUNCE_MS) return;
      const translated = translateAcpxNote(progress.text);
      if (!translated) return;
      const elapsed = Math.floor((now - startedAt) / 1000);
      void reply(`${translated}（已等待 ${elapsed}s）`).catch(() => {});
      lastMessageAt = now;
    };

    const dispose = (): void => {
      if (heartbeatTimer) clearInterval(heartbeatTimer);
    };

    return { handler, dispose };
  }


  private async checkTransportSession(session: ResolvedSession): Promise<boolean> {
    return await this.measureTransportCall("has_session", session, () => this.transport.hasSession(session));
  }

  private async promptTransportSession(
    session: ResolvedSession,
    text: string,
    reply?: (text: string) => Promise<void>,
    replyContext?: ReplyQuotaContext,
  ) {
    session.mcpCoordinatorSession ??= session.transportSession;
    return await this.measureTransportCall("prompt", session, () =>
      this.transport.prompt(session, text, reply, replyContext),
    );
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
