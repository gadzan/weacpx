import type { Agent as ChatAgent, ChatRequestMetadata } from "../weixin/agent/interface";
import type { SessionService } from "../sessions/session-service";
import type { ActiveTurnRegistry } from "../sessions/active-turn-registry";
import type {
  CreateScheduledTaskInput,
  ScheduledTaskService,
} from "../scheduled/scheduled-service";
import type { ScheduledTaskRecord } from "../scheduled/scheduled-types";
import type {
  CancelTaskInput,
  OrchestrationService,
  OrchestrationTaskFilter,
} from "../orchestration/orchestration-service";
import type { OrchestrationTaskRecord } from "../orchestration/orchestration-types";
import type { ControlEventBus } from "./control-event-bus";

export interface ControlSessionInfo {
  alias: string;
  agent: string;
  workspace: string;
  transportSession: string;
  running: boolean;
}

export interface ControlServiceDeps {
  agent: Pick<ChatAgent, "chat">;
  sessions: Pick<
    SessionService,
    "listAllResolvedSessions" | "createSession" | "removeSession" | "useSession"
  >;
  activeTurns: Pick<ActiveTurnRegistry, "isActiveAnywhere">;
  scheduled: Pick<ScheduledTaskService, "listPending" | "createTask" | "cancelPending">;
  orchestration: Pick<OrchestrationService, "listTasks" | "getTask" | "requestTaskCancellation">;
  events: ControlEventBus;
}

export interface ControlPromptInput {
  chatKey: string;
  sessionAlias: string;
  text: string;
  accountId?: string;
  senderId: string;
  isOwner?: boolean;
}

export interface ControlPromptResult {
  ok: boolean;
  text?: string;
  errorMessage?: string;
}

export interface ControlExecuteCommandInput {
  chatKey: string;
  text: string;
  accountId?: string;
  senderId: string;
  isOwner?: boolean;
}

// Thin structured facade over core services for non-text consumers (the relay
// connector first). Holds no state of its own beyond in-flight turn tracking.
export class ControlService {
  constructor(private readonly deps: ControlServiceDeps) {}

  get events(): ControlEventBus {
    return this.deps.events;
  }

  listSessions(): ControlSessionInfo[] {
    return this.deps.sessions.listAllResolvedSessions().map((session) => ({
      alias: session.alias,
      agent: session.agent,
      workspace: session.workspace,
      transportSession: session.transportSession,
      running: this.deps.activeTurns.isActiveAnywhere(session.alias),
    }));
  }

  async createSession(alias: string, agent: string, workspace: string): Promise<ControlSessionInfo> {
    const session = await this.deps.sessions.createSession(alias, agent, workspace);
    this.deps.events.emit({ type: "sessions-changed" });
    return {
      alias: session.alias,
      agent: session.agent,
      workspace: session.workspace,
      transportSession: session.transportSession,
      running: false,
    };
  }

  async removeSession(alias: string): Promise<{ wasActive: boolean }> {
    const result = await this.deps.sessions.removeSession(alias);
    this.deps.events.emit({ type: "sessions-changed" });
    return result;
  }

  listScheduledTasks(chatKey: string): ScheduledTaskRecord[] {
    return this.deps.scheduled.listPending(chatKey);
  }

  async createScheduledTask(input: CreateScheduledTaskInput): Promise<ScheduledTaskRecord> {
    const task = await this.deps.scheduled.createTask(input);
    this.deps.events.emit({ type: "scheduled-changed", chatKey: input.chatKey });
    return task;
  }

  async cancelScheduledTask(id: string, chatKey: string): Promise<boolean> {
    const cancelled = await this.deps.scheduled.cancelPending(id, chatKey);
    if (cancelled) {
      this.deps.events.emit({ type: "scheduled-changed", chatKey });
    }
    return cancelled;
  }

  listOrchestrationTasks(filter?: OrchestrationTaskFilter): Promise<OrchestrationTaskRecord[]> {
    return this.deps.orchestration.listTasks(filter);
  }

  getOrchestrationTask(taskId: string): Promise<OrchestrationTaskRecord | null> {
    return this.deps.orchestration.getTask(taskId);
  }

  async cancelOrchestrationTask(input: CancelTaskInput): Promise<OrchestrationTaskRecord> {
    const task = await this.deps.orchestration.requestTaskCancellation(input);
    this.deps.events.emit({ type: "orchestration-changed" });
    return task;
  }

  private readonly inFlight = new Map<string, AbortController>();

  async prompt(input: ControlPromptInput): Promise<ControlPromptResult> {
    const key = turnKey(input.chatKey, input.sessionAlias);
    if (this.inFlight.has(key)) {
      return { ok: false, errorMessage: "turn-already-running" };
    }
    const controller = new AbortController();
    this.inFlight.set(key, controller);
    try {
      await this.deps.sessions.useSession(input.chatKey, input.sessionAlias);
    } catch (error) {
      this.inFlight.delete(key);
      return { ok: false, errorMessage: toErrorMessage(error) };
    }
    const emitChunk = (chunk: string) => {
      this.deps.events.emit({
        type: "turn-output",
        chatKey: input.chatKey,
        sessionAlias: input.sessionAlias,
        chunk,
      });
    };
    try {
      const response = await this.deps.agent.chat({
        accountId: input.accountId ?? "control",
        conversationId: input.chatKey,
        text: input.text,
        metadata: buildControlMetadata(input.senderId, input.isOwner),
        abortSignal: controller.signal,
        reply: async (chunk) => {
          emitChunk(chunk);
        },
      });
      if (response.text) {
        emitChunk(response.text);
      }
      this.deps.events.emit({
        type: "turn-finished",
        chatKey: input.chatKey,
        sessionAlias: input.sessionAlias,
        ok: true,
      });
      return { ok: true, text: response.text };
    } catch (error) {
      const errorMessage = toErrorMessage(error);
      this.deps.events.emit({
        type: "turn-finished",
        chatKey: input.chatKey,
        sessionAlias: input.sessionAlias,
        ok: false,
        errorMessage,
      });
      return { ok: false, errorMessage };
    } finally {
      this.inFlight.delete(key);
    }
  }

  cancelTurn(chatKey: string, sessionAlias: string): boolean {
    const controller = this.inFlight.get(turnKey(chatKey, sessionAlias));
    if (!controller) {
      return false;
    }
    controller.abort();
    return true;
  }

  async executeCommand(input: ControlExecuteCommandInput): Promise<string> {
    const chunks: string[] = [];
    const response = await this.deps.agent.chat({
      accountId: input.accountId ?? "control",
      conversationId: input.chatKey,
      text: input.text,
      metadata: buildControlMetadata(input.senderId, input.isOwner),
      reply: async (chunk) => {
        chunks.push(chunk);
      },
    });
    if (response.text) {
      chunks.push(response.text);
    }
    return chunks.join("\n");
  }
}

function turnKey(chatKey: string, sessionAlias: string): string {
  return `${chatKey} ${sessionAlias}`;
}

function toErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function buildControlMetadata(senderId: string, isOwner: boolean | undefined): ChatRequestMetadata {
  return {
    channel: "control",
    chatType: "direct",
    senderId,
    ...(isOwner === undefined ? {} : { isOwner }),
  };
}
