export interface TransportConfig {
  type: "acpx-cli" | "acpx-bridge";
  command?: string;
  sessionInitTimeoutMs?: number;
}

export interface AgentConfig {
  driver: string;
  command?: string;
}

export interface WorkspaceConfig {
  cwd: string;
  description?: string;
}

export interface AppConfig {
  transport: TransportConfig;
  agents: Record<string, AgentConfig>;
  workspaces: Record<string, WorkspaceConfig>;
}
