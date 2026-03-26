export interface ResolvedSession {
  alias: string;
  agent: string;
  agentCommand?: string;
  workspace: string;
  transportSession: string;
  cwd: string;
}

export interface SessionTransport {
  ensureSession(session: ResolvedSession): Promise<void>;
  prompt(session: ResolvedSession, text: string): Promise<{ text: string }>;
  cancel(session: ResolvedSession): Promise<{ cancelled: boolean; message: string }>;
  hasSession(session: ResolvedSession): Promise<boolean>;
  listSessions(): Promise<Array<{ name: string; agent: string; workspace: string }>>;
  dispose?(): Promise<void>;
}
