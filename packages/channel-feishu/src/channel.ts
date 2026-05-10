import path from "node:path";
import type {
  ChannelStartInput,
  CoordinatorMessageInput,
  CreateChannelDeps,
  MessageChannelRuntime,
  OrchestrationDeliveryCallbacks,
} from "weacpx/plugin-api";
import type { FeishuChannelConfig, FeishuResolvedAccountConfig } from "./config.js";
import { parseFeishuChannelConfig } from "./config.js";
import type { FeishuMessageEvent } from "./types.js";
import { createFeishuLarkClient, type FeishuLarkClient } from "./lark-client.js";
import { MessageDedup } from "./message-dedup.js";
import { enqueueFeishuChatTask } from "./chat-queue.js";
import { buildFeishuConversationId, evaluateFeishuAccessPolicy, parseFeishuConversationId, shouldHandleFeishuMessage } from "./inbound.js";
import { isMessageExpired } from "./message-dedup.js";
import { sendTextFeishu, sendMediaFeishu } from "./send.js";
import { RuntimeMediaStore, DEFAULT_ATTACHMENT_MAX_BYTES, DEFAULT_IMAGE_MAX_BYTES, DEFAULT_MAX_ATTACHMENTS_PER_MESSAGE } from "./media-store.js";
import { resolveSafeOutboundMediaPath } from "./outbound-media-safety.js";
import { normalizeMediaArray, type ChannelMediaAttachment } from "./media-types.js";
import { convertFeishuMessageContent } from "./content-converters.js";
import { downloadFeishuMessageResource } from "./media.js";

type OrchestrationTaskRecord = Parameters<MessageChannelRuntime["notifyTaskCompletion"]>[0];

interface FeishuChannelDeps extends CreateChannelDeps {
  createClient?: (account: FeishuResolvedAccountConfig) => FeishuLarkClient;
}

interface AccountRuntime {
  account: FeishuResolvedAccountConfig;
  client: FeishuLarkClient;
  botOpenId?: string;
}

export class FeishuChannel implements MessageChannelRuntime {
  readonly id = "feishu";
  private readonly accounts: Map<string, AccountRuntime> = new Map();
  private dedup: MessageDedup;
  private markDelivered: OrchestrationDeliveryCallbacks["markTaskNoticeDelivered"] | null = null;
  private markFailed: OrchestrationDeliveryCallbacks["markTaskNoticeFailed"] | null = null;
  private agent: ChannelStartInput["agent"] | null = null;
  private quota: ChannelStartInput["quota"] | null = null;
  private logger: ChannelStartInput["logger"] | null = null;

  private readonly config: FeishuChannelConfig;

  constructor(
    options: Record<string, unknown> | undefined,
    private readonly deps: FeishuChannelDeps = {},
  ) {
    this.config = parseFeishuChannelConfig(options);
    this.dedup = new MessageDedup({ ttlMs: this.config.dedupTtlMs, maxEntries: this.config.dedupMaxEntries });
  }

  isLoggedIn(): boolean {
    return this.config.accounts.some((account) => account.enabled && account.configured);
  }

  async login(): Promise<string> {
    if (this.isLoggedIn()) return "feishu credentials configured";
    throw new Error("Feishu uses channel.options.appId and channel.options.appSecret; configure them instead of QR login.");
  }

  logout(): void {
    for (const runtime of this.accounts.values()) {
      runtime.client.stop();
    }
    this.accounts.clear();
    this.dedup.dispose();
  }

  configureOrchestration(callbacks: OrchestrationDeliveryCallbacks): void {
    this.markDelivered = callbacks.markTaskNoticeDelivered;
    this.markFailed = callbacks.markTaskNoticeFailed;
  }

  async start(input: ChannelStartInput): Promise<void> {
    this.agent = input.agent;
    this.quota = input.quota;
    this.logger = input.logger;

    const eligible = this.config.accounts.filter((account) => account.enabled && account.configured);
    await input.logger.info("feishu.start", "starting feishu channel", {
      accountCount: eligible.length,
      accounts: eligible.map((account) => account.accountId),
    });

    const startups = eligible.map(async (account) => {
      const client = this.deps.createClient?.(account) ?? createFeishuLarkClient({
        appId: account.appId,
        appSecret: account.appSecret,
        domain: account.domain,
      });
      const probe = await client.probeBot().catch((error) => {
        void input.logger.error("feishu.probe_failed", "failed to probe feishu bot identity", {
          accountId: account.accountId,
          message: error instanceof Error ? error.message : String(error),
        });
        return {} as { botOpenId?: string; botName?: string };
      });
      const runtime: AccountRuntime = { account, client, ...(probe.botOpenId ? { botOpenId: probe.botOpenId } : {}) };
      this.accounts.set(account.accountId, runtime);
      await client.startWS({
        handlers: {
          "im.message.receive_v1": (data) => this.handleMessageEvent(account.accountId, data),
        },
        abortSignal: input.abortSignal,
      });
    });

    await Promise.all(startups);
  }

  async notifyTaskCompletion(task: OrchestrationTaskRecord): Promise<void> {
    if (!task.chatKey) return;
    try {
      await this.sendRouteText(task.chatKey, task.replyContextToken, task.resultText || task.summary || "任务已完成。");
      if (this.markDelivered) await this.markDelivered(task.taskId, task.accountId || this.config.defaultAccount);
    } catch (error) {
      if (this.markFailed) {
        await this.markFailed(task.taskId, error instanceof Error ? error.message : String(error));
        return;
      }
      throw error;
    }
  }

  async notifyTaskProgress(task: OrchestrationTaskRecord, text: string): Promise<void> {
    if (!task.chatKey) return;
    await this.sendRouteText(task.chatKey, task.replyContextToken, text);
  }

  async sendCoordinatorMessage(input: CoordinatorMessageInput): Promise<void> {
    await this.sendRouteText(input.chatKey, input.replyContextToken, input.text);
  }

  private async sendRouteText(chatKey: string, replyContextToken: string | undefined, text: string): Promise<void> {
    const route = parseFeishuConversationId(chatKey);
    if (!route) throw new Error(`cannot deliver Feishu message to non-Feishu chatKey: ${chatKey}`);
    const runtime = this.accounts.get(route.accountId);
    if (!runtime) throw new Error(`feishu account "${route.accountId}" is not started; check channel.options.accounts and enabled flags`);
    await sendTextFeishu({ client: runtime.client.sdk, to: route.chatId, text, replyToMessageId: replyContextToken });
  }

  private async handleMessageEvent(accountId: string, data: unknown): Promise<void> {
    const runtime = this.accounts.get(accountId);
    if (!runtime || !this.agent || !this.quota || !this.logger) {
      throw new Error("FeishuChannel.start() must initialize runtime before handling messages");
    }
    const event = data as FeishuMessageEvent;
    const messageId = event.message?.message_id;
    const chatId = event.message?.chat_id;
    if (!messageId || !chatId) return;

    if (!this.dedup.tryRecord(messageId, accountId)) {
      await this.logger.info("feishu.message.duplicate", "skipping duplicate feishu message", { messageId, accountId });
      return;
    }
    if (isMessageExpired(event.message.create_time)) {
      await this.logger.info("feishu.message.expired", "skipping expired feishu message", { messageId, accountId });
      return;
    }

    const policy = evaluateFeishuAccessPolicy({ event, account: runtime.account });
    if (!policy.allow) {
      await this.logger.info("feishu.message.policy_denied", "feishu message blocked by access policy", {
        accountId,
        messageId,
        chatId,
        chatType: event.message.chat_type,
        senderOpenId: event.sender?.sender_id?.open_id,
        reason: policy.reason,
      });
      return;
    }

    const threadId = event.message.thread_id || event.message.root_id || undefined;
    const chatKey = buildFeishuConversationId(accountId, chatId, threadId);

    const converted = await convertFeishuMessageContent({
      messageType: event.message.message_type,
      content: event.message.content,
      messageId,
      mentions: event.message.mentions,
      botOpenId: runtime.botOpenId,
      stripBotMentions: runtime.account.requireMention,
    });
    const decision = shouldHandleFeishuMessage({
      event,
      botOpenId: runtime.botOpenId,
      requireMention: runtime.account.requireMention,
      parsedText: converted.text,
      allowMediaOnly: converted.resources.length > 0,
    });
    if (!decision.handle) return;

    this.quota.onInbound(chatKey);

    const mediaStore = this.deps.mediaStore ?? new RuntimeMediaStore({ rootDir: path.join(process.cwd(), ".weacpx-media") });
    const media: ChannelMediaAttachment[] = [];
    const skipped = [...converted.skippedNotes];
    for (const resource of converted.resources.slice(0, DEFAULT_MAX_ATTACHMENTS_PER_MESSAGE)) {
      try {
        const downloaded = await downloadFeishuMessageResource({
          client: runtime.client.sdk as never,
          messageId,
          fileKey: resource.fileKey,
          resourceType: resource.kind === "image" ? "image" : "file",
          maxBytes: resource.kind === "image" ? DEFAULT_IMAGE_MAX_BYTES : DEFAULT_ATTACHMENT_MAX_BYTES,
        });
        media.push(await mediaStore.saveMediaBuffer({
          channelId: "feishu",
          accountId,
          chatKey,
          messageId,
          fileName: downloaded.fileName ?? resource.fileName,
          mimeType: downloaded.contentType ?? defaultMimeForKind(resource.kind),
          kind: resource.kind,
          buffer: downloaded.buffer,
          sourceResourceId: resource.fileKey,
          maxBytes: resource.kind === "image" ? DEFAULT_IMAGE_MAX_BYTES : DEFAULT_ATTACHMENT_MAX_BYTES,
        }));
      } catch (error) {
        skipped.push(`Skipped ${resource.kind} ${resource.fileKey}: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
    const requestText = appendSkippedAttachmentNotes(decision.text, skipped);

    const run = enqueueFeishuChatTask({
      accountId,
      chatId,
      ...(threadId ? { threadId } : {}),
      task: async () => {
        if (!this.agent) return;
        const response = await this.agent.chat({
          accountId,
          conversationId: chatKey,
          text: requestText,
          ...(media.length > 0 ? { media } : {}),
          replyContextToken: messageId,
          reply: async (text) => {
            await sendTextFeishu({ client: runtime.client.sdk, to: chatId, text, replyToMessageId: messageId });
          },
        });
        if (response.text && response.text.trim().length > 0) {
          await sendTextFeishu({ client: runtime.client.sdk, to: chatId, text: response.text, replyToMessageId: messageId });
        }
        for (const item of normalizeMediaArray(response.media)) {
          const safePath = await resolveSafeOutboundMediaPath(item.filePath, [this.deps.mediaStore?.rootDir, ...(this.deps.allowedMediaRoots ?? [])].filter((x): x is string => typeof x === "string"));
          if (!safePath) {
            await this.logger!.error("feishu.media.rejected", "outbound media path rejected", { filePath: item.filePath, accountId });
            continue;
          }
          try {
            await sendMediaFeishu({ client: runtime.client.sdk as never, to: chatId, media: { ...item, filePath: safePath }, replyToMessageId: messageId });
          } catch (error) {
            await this.logger!.error("feishu.media.send_failed", "failed to send feishu media", { message: error instanceof Error ? error.message : String(error), accountId });
          }
        }
      },
    });
    await run.promise;
  }
}

function defaultMimeForKind(kind: "image" | "file" | "audio" | "video"): string {
  if (kind === "image") return "image/*";
  if (kind === "audio") return "audio/opus";
  if (kind === "video") return "video/mp4";
  return "application/octet-stream";
}

function appendSkippedAttachmentNotes(text: string, notes: string[]): string {
  if (notes.length === 0) return text;
  return [text, "", "Attachment notes:", ...notes.map((note) => `- ${note}`)].filter(Boolean).join("\n");
}
