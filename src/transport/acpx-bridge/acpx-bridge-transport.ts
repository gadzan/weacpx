import type { ResolvedSession, SessionTransport } from "../types";
import type { BridgeMethod } from "./acpx-bridge-protocol";

interface BridgeRequestClient {
  request<TResult>(method: BridgeMethod, params: Record<string, unknown>): Promise<TResult>;
}

export class AcpxBridgeTransport implements SessionTransport {
  constructor(private readonly client: BridgeRequestClient & { dispose?: () => Promise<void> }) {}

  async ensureSession(session: ResolvedSession): Promise<void> {
    await this.client.request("ensureSession", this.toParams(session));
  }

  async prompt(session: ResolvedSession, text: string, _reply?: (text: string) => Promise<void>): Promise<{ text: string }> {
    return await this.client.request("prompt", {
      ...this.toParams(session),
      text,
    });
  }

  async cancel(session: ResolvedSession): Promise<{ cancelled: boolean; message: string }> {
    return await this.client.request("cancel", this.toParams(session));
  }

  async hasSession(session: ResolvedSession): Promise<boolean> {
    const result = await this.client.request<{ exists: boolean }>("hasSession", this.toParams(session));
    return result.exists;
  }

  async listSessions(): Promise<Array<{ name: string; agent: string; workspace: string }>> {
    return [];
  }

  async dispose(): Promise<void> {
    await this.client.dispose?.();
  }

  private toParams(session: ResolvedSession): Record<string, unknown> {
    return {
      agent: session.agent,
      agentCommand: session.agentCommand,
      cwd: session.cwd,
      name: session.transportSession,
    };
  }
}
