import type { PermissionPolicy, ResolvedSession, SessionTransport } from "../types";
import type { BridgeMethod } from "./acpx-bridge-protocol";

interface BridgeRequestClient {
  request<TResult>(
    method: BridgeMethod,
    params: Record<string, unknown>,
    onEvent?: (event: { type: "prompt.segment"; text: string }) => void,
  ): Promise<TResult>;
}

export class AcpxBridgeTransport implements SessionTransport {
  constructor(private readonly client: BridgeRequestClient & { dispose?: () => Promise<void> }) {}

  async ensureSession(session: ResolvedSession): Promise<void> {
    await this.client.request("ensureSession", this.toParams(session));
  }

  async prompt(session: ResolvedSession, text: string, reply?: (text: string) => Promise<void>): Promise<{ text: string }> {
    return await this.client.request("prompt", {
      ...this.toParams(session),
      text,
    }, (event) => {
      if (event.type === "prompt.segment") {
        void reply?.(event.text);
      }
    });
  }

  async setMode(session: ResolvedSession, modeId: string): Promise<void> {
    await this.client.request("setMode", {
      ...this.toParams(session),
      modeId,
    });
  }

  async cancel(session: ResolvedSession): Promise<{ cancelled: boolean; message: string }> {
    return await this.client.request("cancel", this.toParams(session));
  }

  async hasSession(session: ResolvedSession): Promise<boolean> {
    const result = await this.client.request<{ exists: boolean }>("hasSession", this.toParams(session));
    return result.exists;
  }


  async updatePermissionPolicy(policy: PermissionPolicy): Promise<void> {
    await this.client.request("updatePermissionPolicy", { ...policy });
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
