import { access } from "node:fs/promises";
import { basename, normalize } from "node:path";
import { homedir } from "node:os";

import type { ConfigStore } from "../config/config-store";
import { getAgentTemplate, listAgentTemplates } from "../config/agent-templates";
import type { AppConfig } from "../config/types";
import { renderAgents, renderHelpText, renderWorkspaces } from "../formatting/render-text";
import type { AppLogger } from "../logging/app-logger";
import { createNoopAppLogger } from "../logging/app-logger";
import type { SessionService } from "../sessions/session-service";
import type { SessionTransport } from "../transport/types";
import type { ResolvedSession } from "../transport/types";
import { PromptCommandError } from "../transport/prompt-output";
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
      "upsertWorkspace" | "removeWorkspace" | "upsertAgent" | "removeAgent" | "updateTransport"
    >,
    logger?: AppLogger,
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
        case "permission.status":
          return { text: this.renderPermissionStatus("当前权限模式：") };
        case "permission.mode.set": {
          if (!this.config || !this.configStore) {
            return { text: "当前没有加载可写入的配置。" };
          }

          const updated = await this.configStore.updateTransport({
            permissionMode: command.mode,
          });
          this.replaceConfig(updated);
          return { text: this.renderPermissionStatus("权限模式已更新：") };
        }
        case "permission.auto.status":
          return { text: this.renderPermissionStatus("当前非交互策略：") };
        case "permission.auto.set": {
          if (!this.config || !this.configStore) {
            return { text: "当前没有加载可写入的配置。" };
          }

          const updated = await this.configStore.updateTransport({
            nonInteractivePermissions: command.policy,
          });
          this.replaceConfig(updated);
          return { text: this.renderPermissionStatus("非交互策略已更新：") };
        }
        case "workspaces":
          return { text: this.config ? renderWorkspaces(this.config) : "No config loaded." };
        case "workspace.new": {
          if (!this.config || !this.configStore) {
            return { text: "当前没有加载可写入的配置。" };
          }
          const wsCwd = normalizePathForWorkspace(command.cwd);
          if (!(await pathExists(wsCwd))) {
            return { text: `工作区路径不存在：${command.cwd}` };
          }

          const updated = await this.configStore.upsertWorkspace(command.name, wsCwd);
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
            const result = await this.promptTransportSession(session, command.text, reply);
            return { text: result.text };
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

  private renderPermissionStatus(title: string): string {
    const permissionMode = this.config?.transport.permissionMode ?? "approve-all";
    const nonInteractivePermissions = this.config?.transport.nonInteractivePermissions ?? "fail";

    return [title, `- mode: ${permissionMode}`, `- auto: ${nonInteractivePermissions}`].join("\n");
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

    if (!isPartialPromptOutputError(message)) {
      throw error;
    }

    return {
      text: [
        `当前会话「${session.alias}」执行中断，未收到最终回复。`,
        "请直接重试；如果长时间无响应，可先发送 /cancel 后再重试。",
        `错误信息：${summarizeTransportError(message)}`,
      ].join("\n"),
    };
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

  private async promptTransportSession(session: ResolvedSession, text: string, reply?: (text: string) => Promise<void>) {
    return await this.measureTransportCall("prompt", session, () => this.transport.prompt(session, text, reply));
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

async function pathExists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

function normalizePathForWorkspace(path: string): string {
  const expanded = path.startsWith("~") ? homedir() + path.slice(1) : path;
  return normalize(expanded);
}

function sameWorkspacePath(left: string, right: string): boolean {
  const normalizedLeft = normalizePathForWorkspace(left);
  const normalizedRight = normalizePathForWorkspace(right);

  if (process.platform === "win32") {
    return normalizedLeft.toLowerCase() === normalizedRight.toLowerCase();
  }

  return normalizedLeft === normalizedRight;
}

function summarizeTransportError(message: string): string {
  return message
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 200);
}

function summarizeTransportDiagnostic(output: string): string | undefined {
  const trimmed = output.replace(/\s+/g, " ").trim();
  if (trimmed.length === 0) {
    return undefined;
  }

  return trimmed.slice(0, 200);
}

function summarizeTransportDiagnosticTail(output: string): string | undefined {
  const trimmed = output.replace(/\s+/g, " ").trim();
  if (trimmed.length === 0) {
    return undefined;
  }

  return trimmed.slice(-200);
}

function summarizeTransportNdjson(output: string, prefix: "stdout" | "stderr"): Record<string, string | number> {
  const lines = output
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0);

  if (lines.length === 0) {
    return {};
  }

  const methods = new Set<string>();
  let agentMessageChunkCount = 0;
  let stopReason: string | undefined;

  for (const line of lines) {
    try {
      const payload = JSON.parse(line) as {
        method?: string;
        params?: {
          update?: {
            sessionUpdate?: string;
          };
        };
        result?: {
          stopReason?: string;
        };
      };

      if (typeof payload.method === "string" && payload.method.length > 0) {
        methods.add(payload.method);
      }
      if (payload.params?.update?.sessionUpdate === "agent_message_chunk") {
        agentMessageChunkCount += 1;
      }
      if (typeof payload.result?.stopReason === "string" && payload.result.stopReason.length > 0) {
        stopReason = payload.result.stopReason;
      }
    } catch {
      continue;
    }
  }

  const summary: Record<string, string | number> = {
    [`${prefix}LineCount`]: lines.length,
  };
  if (methods.size > 0) {
    summary[`${prefix}Methods`] = [...methods].join(",");
  }
  if (agentMessageChunkCount > 0) {
    summary[`${prefix}AgentMessageChunkCount`] = agentMessageChunkCount;
  }
  if (stopReason) {
    summary[`${prefix}StopReason`] = stopReason;
  }

  return summary;
}

function isPartialPromptOutputError(message: string): boolean {
  return message.includes("未收到最终回复");
}
