import type { ConfigStore } from "../config/config-store";
import type { AppConfig } from "../config/types";
import type { AppLogger } from "../logging/app-logger";
import type { SessionService } from "../sessions/session-service";
import type { SessionTransport } from "../transport/types";

export interface RouterResponse {
  text: string;
}

export type WritableConfigStore = Pick<
  ConfigStore,
  "upsertWorkspace" | "removeWorkspace" | "upsertAgent" | "removeAgent" | "updateTransport"
>;

export interface CommandRouterContext {
  sessions: SessionService;
  transport: SessionTransport;
  config?: AppConfig;
  configStore?: WritableConfigStore;
  logger: AppLogger;
  replaceConfig: (updated: AppConfig) => void;
}


export interface SessionLifecycleOps {
  resolveSession: (alias: string, agent: string, workspace: string, transportSession: string) => import("../transport/types").ResolvedSession;
  ensureTransportSession: (session: import("../transport/types").ResolvedSession) => Promise<void>;
  checkTransportSession: (session: import("../transport/types").ResolvedSession) => Promise<boolean>;
  handleSessionShortcut: (
    chatKey: string,
    agent: string,
    cwdInput: string,
    createNew: boolean,
  ) => Promise<RouterResponse>;
  resetCurrentSession: (chatKey: string) => Promise<RouterResponse>;
  refreshSessionTransportAgentCommand: (alias: string) => Promise<void>;
}

export interface SessionInteractionOps {
  setModeTransportSession: (session: import("../transport/types").ResolvedSession, modeId: string) => Promise<void>;
  cancelTransportSession: (
    session: import("../transport/types").ResolvedSession,
  ) => Promise<{ cancelled: boolean; message: string }>;
  promptTransportSession: (
    session: import("../transport/types").ResolvedSession,
    text: string,
    reply?: (text: string) => Promise<void>,
  ) => Promise<{ text: string }>;
}

export interface SessionRenderRecoveryOps {
  renderSessionCreationError: (session: import("../transport/types").ResolvedSession, error: unknown) => RouterResponse;
  renderSessionCreationVerificationError: (session: import("../transport/types").ResolvedSession) => RouterResponse;
  tryRecoverMissingSession: (
    session: import("../transport/types").ResolvedSession,
    error: unknown,
  ) => Promise<import("../transport/types").ResolvedSession | null>;
  renderTransportError: (session: import("../transport/types").ResolvedSession, error: unknown) => RouterResponse;
}

export interface SessionShortcutOps {
  resolveSession: (alias: string, agent: string, workspace: string, transportSession: string) => import("../transport/types").ResolvedSession;
  ensureTransportSession: (session: import("../transport/types").ResolvedSession) => Promise<void>;
  checkTransportSession: (session: import("../transport/types").ResolvedSession) => Promise<boolean>;
  refreshSessionTransportAgentCommand: (alias: string) => Promise<void>;
}

export interface SessionRecoveryOps {
  resolveSessionAgentCommand: (
    session: import("../transport/types").ResolvedSession,
  ) => Promise<string | undefined | null>;
  setSessionTransportAgentCommand: (alias: string, command: string) => Promise<void>;
  getSession: (alias: string) => Promise<import("../transport/types").ResolvedSession | null>;
}


export interface SessionResetOps {
  ensureTransportSession: (session: import("../transport/types").ResolvedSession) => Promise<void>;
  checkTransportSession: (session: import("../transport/types").ResolvedSession) => Promise<boolean>;
  resolveSession: (alias: string, agent: string, workspace: string, transportSession: string) => import("../transport/types").ResolvedSession;
  refreshSessionTransportAgentCommand: (alias: string) => Promise<void>;
  now: () => number;
}
