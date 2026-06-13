import {
  MSG,
  type InstanceNoticePayload,
} from "@ganglion/xacpx-relay-protocol";
import type {
  ChannelStartInput,
  CoordinatorMessageInput,
  MessageChannelRuntime,
} from "xacpx/plugin-api";

import { parseRelayChannelConfig, type RelayChannelConfig } from "./config.js";
import { CredentialStore, defaultCredentialPath, type RelayCredential } from "./credential-store.js";
import { createControlBridge, subscribeControlEvents } from "./control-bridge.js";
import { RelayClient, type RelayClientOptions } from "./relay-client.js";

type OrchestrationTaskRecord = Parameters<MessageChannelRuntime["notifyTaskCompletion"]>[0];

interface CredentialStoreLike {
  load(): RelayCredential | null;
  save(credential: RelayCredential): void;
  clear(): void;
}

interface RelayClientLike {
  start(abortSignal: AbortSignal): void;
  stop(): void;
  sendEvent(type: string, payload: unknown): void;
}

export interface RelayChannelDeps {
  credentialStore?: CredentialStoreLike;
  createClient?: (options: RelayClientOptions) => RelayClientLike;
}

export class RelayChannel implements MessageChannelRuntime {
  readonly id = "relay";
  readonly nativeSessionListFormat = "table" as const;

  private readonly config: RelayChannelConfig;
  private readonly credentials: CredentialStoreLike;
  private client: RelayClientLike | null = null;
  private unsubscribe: (() => void) | null = null;

  constructor(options: Record<string, unknown> | undefined, private readonly deps: RelayChannelDeps = {}) {
    this.config = parseRelayChannelConfig(options);
    this.credentials = deps.credentialStore ?? new CredentialStore(defaultCredentialPath());
  }

  isLoggedIn(): boolean {
    return this.credentials.load() !== null || this.config.pairingToken !== undefined;
  }

  async login(): Promise<string> {
    return "relay channel pairs automatically on start; configure it via: xacpx channel add relay --url <ws-url> --token <pairing-token>";
  }

  logout(): void {
    this.credentials.clear();
  }

  async start(input: ChannelStartInput): Promise<void> {
    if (!input.control) {
      throw new Error("relay channel requires ChannelStartInput.control (xacpx >= 0.11)");
    }
    const bridge = createControlBridge(input.control);
    const client = (this.deps.createClient ?? ((options) => new RelayClient(options)))({
      url: this.config.url,
      credentialStore: this.credentials,
      pairingToken: this.config.pairingToken,
      instanceName: this.config.name,
      coreVersion: input.coreVersion,
      onRequest: bridge,
      logger: input.logger,
    });
    this.client = client;
    this.unsubscribe = subscribeControlEvents(input.control, (type, payload) => client.sendEvent(type, payload));
    client.start(input.abortSignal);

    // Channel convention: start() stays pending until shutdown (see run-console).
    await new Promise<void>((resolve) => {
      if (input.abortSignal.aborted) {
        resolve();
        return;
      }
      input.abortSignal.addEventListener("abort", () => resolve(), { once: true });
    });
    this.stop();
  }

  stop(): void {
    this.unsubscribe?.();
    this.unsubscribe = null;
    this.client?.stop();
    this.client = null;
  }

  async notifyTaskCompletion(task: OrchestrationTaskRecord): Promise<void> {
    this.sendNotice({ kind: "task-completion", taskId: task.taskId, text: task.summary || task.resultText || task.taskId });
  }

  async notifyTaskProgress(task: OrchestrationTaskRecord, text: string): Promise<void> {
    this.sendNotice({ kind: "task-progress", taskId: task.taskId, text });
  }

  async sendCoordinatorMessage(input: CoordinatorMessageInput): Promise<void> {
    this.sendNotice({ kind: "coordinator-message", chatKey: input.chatKey, text: input.text });
  }

  private sendNotice(payload: InstanceNoticePayload): void {
    this.client?.sendEvent(MSG.instanceNotice, payload);
  }
}
