import { getChannelIdFromChatKey } from "./channel-scope";
import type {
  ChannelStartInput,
  CoordinatorMessageInput,
  MessageChannelRuntime,
  OrchestrationDeliveryCallbacks,
  ScheduledChannelMessageInput,
} from "./types";
import type { OrchestrationTaskRecord } from "../orchestration/orchestration-types";

export class MessageChannelRegistry {
  private readonly channels: Map<string, MessageChannelRuntime>;

  constructor(channels: MessageChannelRuntime[]) {
    this.channels = new Map(channels.map((channel) => [channel.id, channel]));
  }

  get size(): number {
    return this.channels.size;
  }

  configureOrchestration(callbacks: OrchestrationDeliveryCallbacks): void {
    for (const channel of this.channels.values()) {
      channel.configureOrchestration?.(callbacks);
    }
  }

  async startAll(input: ChannelStartInput): Promise<void> {
    const outcomes = await Promise.allSettled([...this.channels.values()].map(async (channel) => {
      try {
        await channel.start(input);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        await input.logger.error(`channel.${channel.id}.start_failed`, `channel ${channel.id} failed to start: ${message}`, { channel: channel.id });
        throw error;
      }
    }));
    const failed = outcomes.filter((r): r is PromiseRejectedResult => r.status === "rejected");
    if (failed.length === this.channels.size) {
      throw new Error("all channels failed to start");
    }
  }

  /**
   * Shutdown path (signal handlers, startup-error cleanup). Prefers the
   * non-destructive `stop()` and falls back to `logout()` only for channels
   * that predate `stop()` (published plugins whose logout is a benign client
   * stop). Never an intentional credential wipe — that is `xacpx logout`.
   */
  async stopAll(): Promise<void> {
    for (const channel of this.channels.values()) {
      if (channel.stop) {
        await channel.stop();
      } else {
        channel.logout();
      }
    }
  }

  getByChatKey(chatKey: string): MessageChannelRuntime | null {
    return this.channels.get(getChannelIdFromChatKey(chatKey)) ?? null;
  }

  async notifyTaskCompletion(task: OrchestrationTaskRecord): Promise<void> {
    if (!task.chatKey) return;
    await this.requireByChatKey(task.chatKey).notifyTaskCompletion(task);
  }

  async notifyTaskProgress(task: OrchestrationTaskRecord, text: string): Promise<void> {
    if (!task.chatKey) return;
    await this.requireByChatKey(task.chatKey).notifyTaskProgress(task, text);
  }

  async sendCoordinatorMessage(input: CoordinatorMessageInput): Promise<void> {
    await this.requireByChatKey(input.chatKey).sendCoordinatorMessage(input);
  }

  supportsScheduledMessages(chatKey: string): boolean {
    const [candidateChannelId] = chatKey.split(":", 1);
    if (chatKey.includes(":") && candidateChannelId && !this.channels.has(candidateChannelId)) {
      return false;
    }
    const channel = this.getByChatKey(chatKey);
    return !!channel?.sendScheduledMessage;
  }

  async sendScheduledMessage(input: ScheduledChannelMessageInput): Promise<void> {
    const channel = this.requireByChatKey(input.chatKey);
    if (!channel.sendScheduledMessage) {
      throw new Error(`channel '${channel.id}' does not support scheduled messages`);
    }
    await channel.sendScheduledMessage(input);
  }

  nativeSessionListFormat(chatKey: string): "cards" | "table" {
    return this.getByChatKey(chatKey)?.nativeSessionListFormat ?? "table";
  }

  createConsumerLocks(): Array<{ channel: MessageChannelRuntime; create: NonNullable<MessageChannelRuntime["createConsumerLock"]> }> {
    const result: Array<{ channel: MessageChannelRuntime; create: NonNullable<MessageChannelRuntime["createConsumerLock"]> }> = [];
    for (const channel of this.channels.values()) {
      if (channel.createConsumerLock) {
        result.push({ channel, create: channel.createConsumerLock.bind(channel) });
      }
    }
    return result;
  }

  private requireByChatKey(chatKey: string): MessageChannelRuntime {
    const channel = this.getByChatKey(chatKey);
    if (!channel) {
      throw new Error(`no message channel registered for chatKey: ${chatKey}`);
    }
    return channel;
  }
}
