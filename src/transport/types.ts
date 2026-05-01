import type { NonInteractivePermissions, PermissionMode } from "../config/types";
import type { QuotaManager } from "../weixin/messaging/quota-manager.js";

export interface ReplyQuotaContext {
  chatKey: string;
  quota: QuotaManager;
}

export interface PromptMedia {
  type: "image" | "audio" | "video" | "file";
  filePath: string;
  mimeType: string;
  fileName?: string;
}

export interface PermissionPolicy {
  permissionMode: PermissionMode;
  nonInteractivePermissions: NonInteractivePermissions;
}

export interface ResolvedSession {
  alias: string;
  agent: string;
  agentCommand?: string;
  workspace: string;
  transportSession: string;
  mcpCoordinatorSession?: string;
  mcpSourceHandle?: string;
  modeId?: string;
  replyMode?: "stream" | "final" | "verbose";
  cwd: string;
}

export type EnsureSessionProgressStage = "spawn" | "initializing" | "ready";
export type EnsureSessionProgress =
  | EnsureSessionProgressStage
  | { kind: "note"; text: string };

export interface PromptOptions {
  onSegment?: (text: string) => void | Promise<void>;
  media?: PromptMedia;
}

export interface SessionTransport {
  ensureSession(
    session: ResolvedSession,
    onProgress?: (progress: EnsureSessionProgress) => void,
  ): Promise<void>;
  prompt(
    session: ResolvedSession,
    text: string,
    reply?: (text: string) => Promise<void>,
    replyContext?: ReplyQuotaContext,
    options?: PromptOptions,
  ): Promise<{ text: string }>;
  setMode(session: ResolvedSession, modeId: string): Promise<void>;
  cancel(session: ResolvedSession): Promise<{ cancelled: boolean; message: string }>;
  hasSession(session: ResolvedSession): Promise<boolean>;
  removeSession?(session: ResolvedSession): Promise<void>;
  updatePermissionPolicy?(policy: PermissionPolicy): Promise<void>;
  dispose?(): Promise<void>;
}
