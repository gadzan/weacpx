import type { NonInteractivePermissions, PermissionMode } from "../config/types";

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
  modeId?: string;
  replyMode?: "stream" | "final";
  cwd: string;
}

export interface SessionTransport {
  ensureSession(session: ResolvedSession): Promise<void>;
  prompt(session: ResolvedSession, text: string, reply?: (text: string) => Promise<void>): Promise<{ text: string }>;
  setMode(session: ResolvedSession, modeId: string): Promise<void>;
  cancel(session: ResolvedSession): Promise<{ cancelled: boolean; message: string }>;
  hasSession(session: ResolvedSession): Promise<boolean>;
  updatePermissionPolicy?(policy: PermissionPolicy): Promise<void>;
  dispose?(): Promise<void>;
}
