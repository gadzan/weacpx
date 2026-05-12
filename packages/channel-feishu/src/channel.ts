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
import { buildFeishuQueueKey, clearFeishuQueueForAccount, enqueueFeishuChatTask } from "./chat-queue.js";
import { buildFeishuConversationId, evaluateFeishuAccessPolicy, parseFeishuConversationId, shouldHandleFeishuMessage } from "./inbound.js";
import { isMessageExpired } from "./message-dedup.js";
import { sendTextFeishu, sendMediaFeishu } from "./send.js";
import { addTypingIndicator, removeTypingIndicator, type FeishuReactionClient, type TypingIndicatorState } from "./typing.js";
import { extractRawTextFromFeishuEvent, isLikelyAbortText } from "./abort-detect.js";
import { clearMessageUnavailableForAccount, isMessageUnavailable, markIfUnavailableError } from "./message-unavailable.js";
import { PermissionNotifier, extractPermissionError, formatPermissionNotice } from "./permission-error.js";
import { abortAck } from "./strings.js";
import { StreamingCardController, type StreamingCardClient } from "./card/streaming-card-controller.js";
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

interface ActiveTask {
  accountId: string;
  chatId: string;
  messageId: string;
  typingState: TypingIndicatorState;
  abortController: AbortController;
  suppressed: boolean;
  cardController: StreamingCardController | null;
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
  // Stack per chat: when a second turn races into the queue before the first
  // body runs, both are tracked so an inbound stop message can suppress all
  // pending entries. Push on registration, splice on cleanup.
  private readonly activeTasks: Map<string, ActiveTask[]> = new Map();
  private readonly permissionNotifier: PermissionNotifier;

  private readonly config: FeishuChannelConfig;

  constructor(
    options: Record<string, unknown> | undefined,
    private readonly deps: FeishuChannelDeps = {},
  ) {
    this.config = parseFeishuChannelConfig(options);
    this.dedup = new MessageDedup({ ttlMs: this.config.dedupTtlMs, maxEntries: this.config.dedupMaxEntries });
    this.permissionNotifier = new PermissionNotifier(this.config.tuning.permissionNotifyCooldownMs);
  }

  isLoggedIn(): boolean {
    return this.config.accounts.some((account) => account.enabled && account.configured);
  }

  async login(): Promise<string> {
    if (this.isLoggedIn()) return "feishu credentials configured";
    throw new Error("Feishu uses channel.options.appId and channel.options.appSecret; configure them instead of QR login.");
  }

  logout(): void {
    for (const [accountId, runtime] of this.accounts) {
      runtime.client.stop();
      clearMessageUnavailableForAccount(accountId);
      clearFeishuQueueForAccount(accountId);
    }
    this.accounts.clear();
    this.permissionNotifier.reset();
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
    const replyTarget = replyContextToken && !isMessageUnavailable(replyContextToken, route.accountId) ? replyContextToken : undefined;
    try {
      await sendTextFeishu({ client: runtime.client.sdk, to: route.chatId, text, replyToMessageId: replyTarget });
    } catch (error) {
      if (replyTarget && markIfUnavailableError(replyTarget, error, route.accountId)) {
        await sendTextFeishu({ client: runtime.client.sdk, to: route.chatId, text });
        return;
      }
      if (await this.maybeNotifyPermissionError({ runtime, chatId: route.chatId, error })) return;
      throw error;
    }
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
    const queueKey = buildFeishuQueueKey(accountId, chatId, threadId);

    const rawText = extractRawTextFromFeishuEvent(event);
    if (rawText && isLikelyAbortText(rawText)) {
      const stack = this.activeTasks.get(queueKey);
      const liveTasks = stack?.filter((t) => !t.suppressed) ?? [];
      if (liveTasks.length > 0) {
        await this.handleAbortFastPath({
          runtime,
          activeTasks: liveTasks,
          abortRequestMessageId: messageId,
          chatId,
          accountId,
        });
        return;
      }
      await this.logger.info("feishu.abort.no_active", "abort trigger received but no active task", { accountId, chatId, messageId });
      // fall through — let it be handled as a regular message (agent decides)
    }

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

    // Pre-register the active task BEFORE enqueue so an abort message that
    // arrives while we're still queued (waiting for the prior task in the
    // chat-queue) can still find us and mark us suppressed.
    const abortController = new AbortController();
    const active: ActiveTask = {
      accountId,
      chatId,
      messageId,
      typingState: { messageId, reactionId: null },
      abortController,
      suppressed: false,
      cardController: null,
    };
    {
      const stack = this.activeTasks.get(queueKey) ?? [];
      stack.push(active);
      this.activeTasks.set(queueKey, stack);
    }

    const run = enqueueFeishuChatTask({
      accountId,
      chatId,
      ...(threadId ? { threadId } : {}),
      task: async () => {
        try {
          if (!this.agent) return;
          if (active.suppressed) return;
          active.typingState = await addTypingIndicator({
            client: runtime.client.sdk as unknown as FeishuReactionClient,
            messageId,
            accountId,
          });
          if (active.suppressed) return;

          // Try to set up streaming card if the account opted in. Any failure
          // (permission, SDK missing CardKit, network) falls back to static.
          const effectiveReplyMode = resolveEffectiveReplyMode(runtime.account.replyMode, event.message.chat_type);
          if (effectiveReplyMode === "streaming") {
            try {
              const controller = new StreamingCardController({
                client: runtime.client.sdk as unknown as StreamingCardClient,
                accountId,
                flushIntervalMs: this.config.tuning.cardFlushIntervalMs,
                failureThreshold: this.config.tuning.cardFailureThreshold,
                imageResolveTimeoutMs: this.config.tuning.imageResolveTimeoutMs,
                imageMaxBytes: this.config.tuning.imageMaxBytes,
                imageCacheCap: this.config.tuning.imageCacheCap,
                onCardDegraded: ({ buffer, consecutiveFailures }) => {
                  void this.logger?.error(
                    "feishu.card.degraded",
                    "streaming card updates failing; will deliver answer via plain reply",
                    { accountId, chatId, consecutiveFailures, bufferChars: buffer.length },
                  );
                },
              });
              await controller.seed({ to: chatId, replyToMessageId: messageId });
              active.cardController = controller;
            } catch (error) {
              const permErr = extractPermissionError(error);
              await this.logger!.info("feishu.streaming.fallback", "streaming card seed failed; falling back to static", {
                accountId,
                chatId,
                reason: permErr ? "permission" : "seed_error",
                message: error instanceof Error ? error.message : String(error),
              });
              if (permErr) {
                await this.maybeNotifyPermissionError({ runtime, chatId, error });
              }
              active.cardController = null;
            }
          }

          const safeReply = async (text: string): Promise<void> => {
            if (active.suppressed) return;
            if (active.cardController) {
              active.cardController.appendStream(text);
              return;
            }
            await this.sendReplyWithGuard({ runtime, chatId, replyToMessageId: messageId, text });
          };

          try {
            const response = await this.agent.chat({
              accountId,
              conversationId: chatKey,
              text: requestText,
              ...(media.length > 0 ? { media } : {}),
              replyContextToken: messageId,
              reply: safeReply,
              abortSignal: abortController.signal,
            });
            if (active.suppressed) return;
            const responseText = response.text?.trim() ?? "";
            if (active.cardController) {
              // Always terminate the card — even if the agent returned no text,
              // otherwise the user sees "Processing..." forever (#2).
              await active.cardController.complete(responseText.length > 0 ? response.text : "");
              // If the card subsystem gave up (N consecutive update failures),
              // deliver the answer as a plain reply so the user still sees it.
              if (active.cardController.isDegraded() && responseText.length > 0) {
                await this.sendReplyWithGuard({ runtime, chatId, replyToMessageId: messageId, text: response.text! });
              }
            } else if (responseText.length > 0) {
              await this.sendReplyWithGuard({ runtime, chatId, replyToMessageId: messageId, text: response.text! });
            }
            for (const item of normalizeMediaArray(response.media)) {
              if (active.suppressed) return;
              const safePath = await resolveSafeOutboundMediaPath(item.filePath, [this.deps.mediaStore?.rootDir, ...(this.deps.allowedMediaRoots ?? [])].filter((x): x is string => typeof x === "string"));
              if (!safePath) {
                await this.logger!.error("feishu.media.rejected", "outbound media path rejected", { filePath: item.filePath, accountId });
                continue;
              }
              try {
                const mediaReplyTarget = isMessageUnavailable(messageId, accountId) ? undefined : messageId;
                await sendMediaFeishu({ client: runtime.client.sdk as never, to: chatId, media: { ...item, filePath: safePath }, ...(mediaReplyTarget ? { replyToMessageId: mediaReplyTarget } : {}) });
              } catch (error) {
                markIfUnavailableError(messageId, error, accountId);
                if (await this.maybeNotifyPermissionError({ runtime, chatId, error })) continue;
                await this.logger!.error("feishu.media.send_failed", "failed to send feishu media", { message: error instanceof Error ? error.message : String(error), accountId });
              }
            }
          } catch (error) {
            if (active.cardController && !active.cardController.isTerminated()) {
              await active.cardController.fail(error instanceof Error ? error.message : String(error));
            }
            throw error;
          }
        } finally {
          const stack = this.activeTasks.get(queueKey);
          if (stack) {
            const i = stack.indexOf(active);
            if (i >= 0) stack.splice(i, 1);
            if (stack.length === 0) this.activeTasks.delete(queueKey);
          }
          await removeTypingIndicator({
            client: runtime.client.sdk as unknown as FeishuReactionClient,
            state: active.typingState,
            accountId,
          });
        }
      },
    });
    await run.promise;
  }

  private async handleAbortFastPath(input: {
    runtime: AccountRuntime;
    activeTasks: ActiveTask[];
    abortRequestMessageId: string;
    chatId: string;
    accountId: string;
  }): Promise<void> {
    const { runtime, activeTasks, abortRequestMessageId, chatId, accountId } = input;
    // Suppress and signal every pending entry — user said "stop", they mean
    // everything pending for them. The most-recent entry decides whether the
    // ack lands as a card update vs plain reply.
    for (const t of activeTasks) {
      t.suppressed = true;
      try {
        t.abortController.abort();
      } catch {
        // AbortController.abort() never throws in practice; defensive
      }
    }
    const target = activeTasks[activeTasks.length - 1]!;
    await this.logger!.info("feishu.abort.triggered", "abort fast-path triggered for active task", {
      accountId,
      chatId,
      activeMessageId: target.messageId,
      abortRequestMessageId,
      suppressedCount: activeTasks.length,
      mode: target.cardController ? "streaming" : "static",
    });
    // Clear typing indicators for all suppressed turns.
    await Promise.all(activeTasks.map((t) => removeTypingIndicator({
      client: runtime.client.sdk as unknown as FeishuReactionClient,
      state: t.typingState,
      accountId,
    })));
    if (target.cardController && !target.cardController.isTerminated()) {
      try {
        await target.cardController.abort(abortAck());
      } catch (error) {
        await this.logger!.error("feishu.abort.card_update_failed", "failed to render aborted card", {
          accountId,
          chatId,
          message: error instanceof Error ? error.message : String(error),
        });
      }
      return;
    }
    try {
      await this.sendReplyWithGuard({
        runtime,
        chatId,
        replyToMessageId: abortRequestMessageId,
        text: abortAck(),
      });
    } catch (error) {
      await this.logger!.error("feishu.abort.ack_failed", "failed to send abort acknowledgement", {
        accountId,
        chatId,
        message: error instanceof Error ? error.message : String(error),
      });
    }
  }

  private async sendReplyWithGuard(input: {
    runtime: AccountRuntime;
    chatId: string;
    replyToMessageId: string;
    text: string;
  }): Promise<void> {
    const { runtime, chatId, replyToMessageId, text } = input;
    const accountId = runtime.account.accountId;
    const replyTarget = isMessageUnavailable(replyToMessageId, accountId) ? undefined : replyToMessageId;
    try {
      await sendTextFeishu({
        client: runtime.client.sdk,
        to: chatId,
        text,
        ...(replyTarget ? { replyToMessageId: replyTarget } : {}),
      });
    } catch (error) {
      if (replyTarget && markIfUnavailableError(replyToMessageId, error, accountId)) {
        await sendTextFeishu({ client: runtime.client.sdk, to: chatId, text });
        return;
      }
      if (await this.maybeNotifyPermissionError({ runtime, chatId, error })) return;
      throw error;
    }
  }

  private async maybeNotifyPermissionError(input: {
    runtime: AccountRuntime;
    chatId: string;
    error: unknown;
  }): Promise<boolean> {
    const permErr = extractPermissionError(input.error);
    if (!permErr) return false;
    const cooldownKey = `${input.runtime.account.accountId}:${input.chatId}:${permErr.code}`;
    if (!this.permissionNotifier.tryReserve(cooldownKey)) {
      await this.logger?.info("feishu.permission.suppressed", "permission notification suppressed by cooldown", {
        accountId: input.runtime.account.accountId,
        chatId: input.chatId,
        code: permErr.code,
      });
      return true;
    }
    await this.logger?.info("feishu.permission.notify", "surfacing feishu permission error to user", {
      accountId: input.runtime.account.accountId,
      chatId: input.chatId,
      code: permErr.code,
      grantUrl: permErr.grantUrl,
    });
    try {
      await sendTextFeishu({
        client: input.runtime.client.sdk,
        to: input.chatId,
        text: formatPermissionNotice(permErr),
      });
      this.permissionNotifier.commit(cooldownKey);
    } catch (notifyError) {
      // Don't burn the cooldown on a failed delivery — the user got nothing.
      this.permissionNotifier.rollback(cooldownKey);
      await this.logger?.error("feishu.permission.notify_failed", "failed to deliver permission notification", {
        accountId: input.runtime.account.accountId,
        chatId: input.chatId,
        message: notifyError instanceof Error ? notifyError.message : String(notifyError),
      });
    }
    return true;
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

/**
 * `auto` resolves to streaming for direct chats and static for groups, since
 * cards in group chats are visually heavier and the multi-message static path
 * is fine when group members aren't watching a single conversation.
 */
function resolveEffectiveReplyMode(
  configured: "static" | "streaming" | "auto",
  chatType: string,
): "static" | "streaming" {
  if (configured !== "auto") return configured;
  return chatType === "group" ? "static" : "streaming";
}
