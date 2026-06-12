import type { Agent as ChatAgent } from "../weixin/agent/interface";
import type { SessionService } from "../sessions/session-service";
import type { ActiveTurnRegistry } from "../sessions/active-turn-registry";
import type {
  CreateScheduledTaskInput,
  ScheduledTaskService,
} from "../scheduled/scheduled-service";
import type { ScheduledTaskRecord } from "../scheduled/scheduled-types";
import type { OrchestrationService } from "../orchestration/orchestration-service";
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
}
