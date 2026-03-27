import { access } from "node:fs/promises";
import { basename, normalize } from "node:path";

import type { ConfigStore } from "../config/config-store";
import { getAgentTemplate, listAgentTemplates } from "../config/agent-templates";
import type { AppConfig } from "../config/types";
import { renderAgents, renderHelpText, renderWorkspaces } from "../formatting/render-text";
import type { AppLogger } from "../logging/app-logger";
import { createNoopAppLogger } from "../logging/app-logger";
import type { SessionService } from "../sessions/session-service";
import type { SessionTransport } from "../transport/types";
import type { ResolvedSession } from "../transport/types";
import { parseCommand } from "./parse-command";

interface RouterResponse {
  text: string;
}

interface ShortcutWorkspaceResolution {
  name: string;
  cwd: string;
  reused: boolean;
}

export class CommandRouter {
  private readonly logger: AppLogger;

  constructor(
    private readonly sessions: SessionService,
    private readonly transport: SessionTransport,
    private readonly config?: AppConfig,
    private readonly configStore?: Pick<
      ConfigStore,
      "upsertWorkspace" | "removeWorkspace" | "upsertAgent" | "removeAgent"
    >,
    logger?: AppLogger,
  ) {
    this.logger = logger ?? createNoopAppLogger();
  }

  async handle(chatKey: string, input: string): Promise<RouterResponse> {
    const startedAt = Date.now();
    const command = parseCommand(input);
    await this.logger.debug("command.parsed", "parsed inbound command", {
      chatKey,
      kind: command.kind,
    });

    return await this.executeCommand(chatKey, command.kind, startedAt, async () => {
      switch (command.kind) {
        case "help":
          return { text: renderHelpText() };
        case "agents":
          return { text: this.config ? renderAgents(this.config) : "No config loaded." };
        case "agent.add": {
          if (!this.config || !this.configStore) {
            return { text: "当前没有加载可写入的配置。" };
          }

          const template = getAgentTemplate(command.template);
          if (!template) {
            return { text: `暂不支持这个 Agent 模板。当前可用：${listAgentTemplates().join("、")}` };
          }

          const updated = await this.configStore.upsertAgent(command.template, template);
          this.replaceConfig(updated);
          return { text: `Agent「${command.template}」已保存` };
        }
        case "agent.rm": {
          if (!this.config || !this.configStore) {
            return { text: "当前没有加载可写入的配置。" };
          }
          if (!this.config.agents[command.name]) {
            return { text: "没有找到这个 Agent。" };
          }

          const updated = await this.configStore.removeAgent(command.name);
          this.replaceConfig(updated);
          return { text: `Agent「${command.name}」已删除` };
        }
        case "workspaces":
          return { text: this.config ? renderWorkspaces(this.config) : "No config loaded." };
        case "workspace.new": {
          if (!this.config || !this.configStore) {
            return { text: "当前没有加载可写入的配置。" };
          }
          if (!(await pathExists(command.cwd))) {
            return { text: `工作区路径不存在：${command.cwd}` };
          }

          const updated = await this.configStore.upsertWorkspace(command.name, command.cwd);
          this.replaceConfig(updated);
          return { text: `工作区「${command.name}」已保存` };
        }
        case "workspace.rm": {
          if (!this.config || !this.configStore) {
            return { text: "当前没有加载可写入的配置。" };
          }

          const updated = await this.configStore.removeWorkspace(command.name);
          this.replaceConfig(updated);
          return { text: `工作区「${command.name}」已删除` };
        }
        case "sessions": {
          const sessions = await this.sessions.listSessions(chatKey);
          if (sessions.length === 0) {
            return { text: "还没有会话。请先执行 /session new <alias> --agent <name> --ws <name>。" };
          }
          return {
            text: [
              "会话列表：",
              ...sessions.map((session) =>
                `- ${session.alias} (${session.agent} @ ${session.workspace})${session.isCurrent ? " [当前]" : ""}`,
              ),
            ].join("\n"),
          };
        }
        case "session.new": {
          const session = this.sessions.resolveSession(
            command.alias,
            command.agent,
            command.workspace,
            `${command.workspace}:${command.alias}`,
          );
          try {
            await this.ensureTransportSession(session);
            const exists = await this.checkTransportSession(session);
            if (!exists) {
              return this.renderSessionCreationVerificationError(session);
            }
          } catch (error) {
            return this.renderSessionCreationError(session, error);
          }
          await this.sessions.attachSession(
            command.alias,
            command.agent,
            command.workspace,
            session.transportSession,
          );
          await this.sessions.useSession(chatKey, command.alias);
          await this.logger.info("session.created", "created and selected logical session", {
            alias: command.alias,
            agent: command.agent,
            workspace: command.workspace,
          });
          return { text: `会话「${command.alias}」已创建并切换` };
        }
        case "session.shortcut":
          return await this.handleSessionShortcut(chatKey, command.agent, command.cwd, false);
        case "session.shortcut.new":
          return await this.handleSessionShortcut(chatKey, command.agent, command.cwd, true);
        case "session.attach": {
          const attached = this.sessions.resolveSession(
            command.alias,
            command.agent,
            command.workspace,
            command.transportSession,
          );
          const exists = await this.checkTransportSession(attached);
          if (!exists) {
            return {
              text: [
                "没有找到可绑定的已有会话。",
                `请确认会话名是否正确，然后重新执行：/session attach ${command.alias} --agent ${command.agent} --ws ${command.workspace} --name <会话名>`,
              ].join("\n"),
            };
          }
          await this.sessions.attachSession(
            command.alias,
            command.agent,
            command.workspace,
            command.transportSession,
          );
          await this.sessions.useSession(chatKey, command.alias);
          await this.logger.info("session.attached", "attached existing transport session", {
            alias: command.alias,
            agent: command.agent,
            workspace: command.workspace,
            transportSession: command.transportSession,
          });
          return { text: `会话「${command.alias}」已绑定并切换` };
        }
        case "session.use":
          await this.sessions.useSession(chatKey, command.alias);
          await this.logger.info("session.selected", "selected logical session", {
            alias: command.alias,
            chatKey,
          });
          return { text: `已切换到会话「${command.alias}」` };
        case "status": {
          const session = await this.sessions.getCurrentSession(chatKey);
          if (!session) {
            return { text: "当前还没有选中的会话。请先执行 /session new ... 或 /use <alias>。" };
          }
          return {
            text: [
              "当前会话：",
              `- 名称：${session.alias}`,
              `- Agent：${session.agent}`,
              `- 工作区：${session.workspace}`,
            ].join("\n"),
          };
        }
        case "cancel": {
          const session = await this.sessions.getCurrentSession(chatKey);
          if (!session) {
            return { text: "当前还没有选中的会话。请先执行 /session new ... 或 /use <alias>。" };
          }
          try {
            const result = await this.cancelTransportSession(session);
            return { text: result.message || "cancelled" };
          } catch (error) {
            return this.renderTransportError(session, error);
          }
        }
        case "prompt": {
          const session = await this.sessions.getCurrentSession(chatKey);
          if (!session) {
            return { text: "当前还没有选中的会话。请先执行 /session new ... 或 /use <alias>。" };
          }
          try {
            const reply = await this.promptTransportSession(session, command.text);
            return { text: reply.text };
          } catch (error) {
            return this.renderTransportError(session, error);
          }
        }
      }
    });
  }

  private async handleSessionShortcut(
    chatKey: string,
    agent: string,
    cwdInput: string,
    createNew: boolean,
  ): Promise<RouterResponse> {
    if (!this.config || !this.configStore) {
      return { text: "当前没有加载可写入的配置。" };
    }

    const cwd = normalizePathForWorkspace(cwdInput);
    if (!(await pathExists(cwd))) {
      return { text: `工作区路径不存在：${cwdInput}` };
    }

    const workspace = await this.resolveShortcutWorkspace(cwd);
    await this.logger.info("session.shortcut.workspace", "resolved shortcut workspace", {
      workspace: workspace.name,
      cwd: workspace.cwd,
      reused: workspace.reused,
    });
    const baseAlias = `${workspace.name}:${agent}`;
    const alias = createNew
      ? await this.allocateUniqueSessionAlias(baseAlias, chatKey)
      : baseAlias;

    if (!createNew && (await this.hasLogicalSession(alias, chatKey))) {
      await this.sessions.useSession(chatKey, alias);
      await this.logger.info("session.shortcut.reused", "reused existing logical session", {
        alias,
        workspace: workspace.name,
        agent,
      });
      return {
        text: [
          `已切换到会话「${alias}」`,
          `- 复用工作区：${workspace.name}`,
          `- 复用会话：${alias}`,
        ].join("\n"),
      };
    }

    const session = this.sessions.resolveSession(alias, agent, workspace.name, `${workspace.name}:${alias}`);
    try {
      await this.ensureTransportSession(session);
      const exists = await this.checkTransportSession(session);
      if (!exists) {
        return this.renderShortcutSessionCreationError(workspace, alias);
      }
    } catch {
      return this.renderShortcutSessionCreationError(workspace, alias);
    }

    await this.sessions.attachSession(alias, agent, workspace.name, session.transportSession);
    await this.sessions.useSession(chatKey, alias);
    await this.logger.info("session.shortcut.created", "created new logical session from shortcut", {
      alias,
      workspace: workspace.name,
      agent,
      workspaceReused: workspace.reused,
    });

    return {
      text: [
        `已创建并切换到会话「${alias}」`,
        workspace.reused ? `- 复用工作区：${workspace.name}` : `- 新增工作区：${workspace.name} -> ${workspace.cwd}`,
        `- 新增会话：${alias}`,
      ].join("\n"),
    };
  }

  private replaceConfig(updated: AppConfig): void {
    if (!this.config) {
      return;
    }

    // Replace reference to prevent mutation of caller's object
    this.config.transport = { ...updated.transport };
    this.config.agents = { ...updated.agents };
    this.config.workspaces = { ...updated.workspaces };
  }

  private renderTransportError(session: ResolvedSession, error: unknown): RouterResponse {
    const message = error instanceof Error ? error.message : String(error);

    if (message.includes("No acpx session found")) {
      return {
        text: [
          `当前会话「${session.alias}」暂时不可用。`,
          `请先在微信里重新执行：/session new ${session.alias} --agent ${session.agent} --ws ${session.workspace}`,
          `如果你要绑定一个已有会话，再执行：/session attach ${session.alias} --agent ${session.agent} --ws ${session.workspace} --name <会话名>`,
        ].join("\n"),
      };
    }

    throw error;
  }

  private renderSessionCreationError(session: ResolvedSession, error: unknown): RouterResponse {
    const message = error instanceof Error ? error.message : String(error);

    if (message.includes("timed out") && message.includes("sessions new")) {
      return this.renderSessionCreationVerificationError(session);
    }

    throw error;
  }

  private renderSessionCreationVerificationError(session: ResolvedSession): RouterResponse {
    return {
      text: [
        "当前还不能直接在微信里创建新会话。",
        `请先准备好一个已有会话，然后在微信里执行：/session attach ${session.alias} --agent ${session.agent} --ws ${session.workspace} --name <会话名>`,
      ].join("\n"),
    };
  }

  private async resolveShortcutWorkspace(cwd: string): Promise<ShortcutWorkspaceResolution> {
    const existingByPath = Object.entries(this.config?.workspaces ?? {}).find(([, workspace]) =>
      sameWorkspacePath(workspace.cwd, cwd),
    );
    if (existingByPath) {
      return {
        name: existingByPath[0],
        cwd: existingByPath[1].cwd,
        reused: true,
      };
    }

    const baseName = basename(cwd);
    const workspaceName = this.allocateWorkspaceName(baseName, cwd);
    const updated = await this.configStore!.upsertWorkspace(workspaceName, cwd);
    this.replaceConfig(updated);

    return {
      name: workspaceName,
      cwd,
      reused: false,
    };
  }

  private allocateWorkspaceName(baseName: string, cwd: string): string {
    if (!this.config?.workspaces[baseName]) {
      return baseName;
    }

    let suffix = 2;
    while (this.config.workspaces[`${baseName}-${suffix}`]) {
      suffix += 1;
    }

    return `${baseName}-${suffix}`;
  }

  private async allocateUniqueSessionAlias(baseAlias: string, chatKey: string): Promise<string> {
    if (!(await this.hasLogicalSession(baseAlias, chatKey))) {
      return baseAlias;
    }

    let suffix = 2;
    while (await this.hasLogicalSession(`${baseAlias}-${suffix}`, chatKey)) {
      suffix += 1;
    }

    return `${baseAlias}-${suffix}`;
  }

  private async hasLogicalSession(alias: string, chatKey: string): Promise<boolean> {
    const sessions = await this.sessions.listSessions(chatKey);
    return sessions.some((session) => session.alias === alias);
  }

  private renderShortcutSessionCreationError(
    workspace: ShortcutWorkspaceResolution,
    alias: string,
  ): RouterResponse {
    return {
      text: [
        `会话「${alias}」创建失败。`,
        workspace.reused ? `- 复用工作区：${workspace.name}` : `- 已新增工作区：${workspace.name} -> ${workspace.cwd}`,
        "- 会话未创建，请重试。",
      ].join("\n"),
    };
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

  private async promptTransportSession(session: ResolvedSession, text: string) {
    return await this.measureTransportCall("prompt", session, () => this.transport.prompt(session, text));
  }

  private async cancelTransportSession(session: ResolvedSession) {
    return await this.measureTransportCall("cancel", session, () => this.transport.cancel(session));
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
      await this.logger.error(`transport.${operation}.failed`, "transport operation failed", {
        operation,
        agent: session.agent,
        workspace: session.workspace,
        alias: session.alias,
        durationMs: Date.now() - startedAt,
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  }
}

async function pathExists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

function normalizePathForWorkspace(path: string): string {
  return normalize(path);
}

function sameWorkspacePath(left: string, right: string): boolean {
  const normalizedLeft = normalizePathForWorkspace(left);
  const normalizedRight = normalizePathForWorkspace(right);

  if (process.platform === "win32") {
    return normalizedLeft.toLowerCase() === normalizedRight.toLowerCase();
  }

  return normalizedLeft === normalizedRight;
}
