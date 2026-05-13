import type {
  ChannelStartInput,
  CoordinatorMessageInput,
  MessageChannelRuntime,
  OrchestrationDeliveryCallbacks,
} from "weacpx/plugin-api";
import { parseYuanbaoChannelConfig, type YuanbaoChannelConfig, type YuanbaoResolvedAccountConfig } from "./config.js";
import type { YuanbaoGateway, YuanbaoGatewayFactory, YuanbaoGatewayInboundMessage } from "./types.js";
import { buildYuanbaoChatKey, extractYuanbaoContent, parseYuanbaoChatKey } from "./inbound.js";
import { loadYuanbaoGatewayFromModule } from "./gateway-loader.js";
import { createBuiltinYuanbaoGateway } from "./builtin-gateway.js";
import { normalizeMediaArray } from "./media-types.js";
import { MessageDedup } from "./message-dedup.js";
import { enqueueYuanbaoChatTask } from "./chat-queue.js";
import { ReplyQuoteCache } from "./reply-quote-cache.js";
import {
  createOutboundQueueSession,
  type OutboundQueueScheduler,
  type OutboundQueueStrategy,
} from "./outbound-queue.js";
import { chunkMarkdownAware } from "./markdown-chunker.js";

type OrchestrationTaskRecord = Parameters<MessageChannelRuntime["notifyTaskCompletion"]>[0];

const REPLY_HEARTBEAT_RUNNING = 1;
const REPLY_HEARTBEAT_FINISH = 2;
const REPLY_HEARTBEAT_INTERVAL_MS = 2_000;

export interface YuanbaoChannelDeps {
  createGateway?: YuanbaoGatewayFactory;
  /** Test hook: override the outbound queue's idle-timer scheduler. */
  outboundSchedule?: OutboundQueueScheduler;
}

export class YuanbaoChannel implements MessageChannelRuntime {
  readonly id = "yuanbao";
  private readonly config: YuanbaoChannelConfig;
  private gateway: YuanbaoGateway | null = null;
  private agent: ChannelStartInput["agent"] | null = null;
  private quota: ChannelStartInput["quota"] | null = null;
  private logger: ChannelStartInput["logger"] | null = null;
  private abortSignal: AbortSignal | null = null;
  private readonly dedup = new MessageDedup();
  private readonly replyQuoteSent = new ReplyQuoteCache();
  private markDelivered: OrchestrationDeliveryCallbacks["markTaskNoticeDelivered"] | null = null;
  private markFailed: OrchestrationDeliveryCallbacks["markTaskNoticeFailed"] | null = null;

  constructor(options: Record<string, unknown> | undefined, private readonly deps: YuanbaoChannelDeps = {}) {
    this.config = parseYuanbaoChannelConfig(options);
  }

  isLoggedIn(): boolean {
    return this.config.accounts.some((account) => account.enabled && account.configured);
  }

  async login(): Promise<string> {
    if (this.isLoggedIn()) return "yuanbao credentials configured";
    throw new Error("Yuanbao uses channel.options.appKey and channel.options.appSecret; configure them instead of QR login.");
  }

  logout(): void {
    this.gateway?.stop?.();
    this.gateway = null;
    this.abortSignal = null;
    this.dedup.dispose();
    this.replyQuoteSent.clear();
  }

  private isAborted(): boolean {
    return Boolean(this.abortSignal?.aborted);
  }

  configureOrchestration(callbacks: OrchestrationDeliveryCallbacks): void {
    this.markDelivered = callbacks.markTaskNoticeDelivered;
    this.markFailed = callbacks.markTaskNoticeFailed;
  }

  async start(input: ChannelStartInput): Promise<void> {
    this.agent = input.agent;
    this.quota = input.quota;
    this.logger = input.logger;
    this.abortSignal = input.abortSignal;
    this.gateway = await this.resolveGateway();
    const accounts = this.config.accounts.filter((account) => account.enabled && account.configured);
    await input.logger.info("yuanbao.start", "starting yuanbao channel", { accounts: accounts.map((account) => account.accountId).join(",") });
    await this.gateway.start({
      accounts,
      abortSignal: input.abortSignal,
      logger: input.logger,
      onMessage: (message) => this.handleInboundMessage(message),
    });
  }

  async notifyTaskCompletion(task: OrchestrationTaskRecord): Promise<void> {
    if (!task.chatKey) return;
    if (this.isAborted()) return;
    try {
      const delivered = await this.sendRouteText(task.chatKey, task.replyContextToken, task.resultText || task.summary || "任务已完成。");
      if (this.markDelivered) await this.markDelivered(task.taskId, task.accountId || delivered.accountId);
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
    if (this.isAborted()) return;
    await this.sendRouteText(task.chatKey, task.replyContextToken, text);
  }

  async sendCoordinatorMessage(input: CoordinatorMessageInput): Promise<void> {
    if (this.isAborted()) return;
    await this.sendRouteText(input.chatKey, input.replyContextToken, input.text);
  }

  private async resolveGateway(): Promise<YuanbaoGateway> {
    if (this.deps.createGateway) return this.deps.createGateway({ config: this.config });
    if (this.config.gatewayModule) return await loadYuanbaoGatewayFromModule(this.config.gatewayModule, this.config);
    return createBuiltinYuanbaoGateway();
  }

  private accountById(accountId: string): YuanbaoResolvedAccountConfig | undefined {
    return this.config.accounts.find((account) => account.accountId === accountId);
  }

  private async sendRouteText(chatKey: string, replyContextToken: string | undefined, text: string): Promise<{ accountId: string }> {
    if (!this.gateway) throw new Error("YuanbaoChannel.start() must be called before delivery");
    const route = parseYuanbaoChatKey(chatKey);
    if (!route) throw new Error(`cannot deliver Yuanbao message to non-Yuanbao chatKey: ${chatKey}`);
    const account = this.accountById(route.accountId);
    if (!account) throw new Error(`unknown Yuanbao account in chatKey: ${route.accountId}`);
    await this.sendTextChunks({
      account,
      chatType: route.chatType,
      target: route.target,
      text,
      replyContextToken,
    });
    return { accountId: route.accountId };
  }

  private splitText(account: YuanbaoResolvedAccountConfig, text: string): string[] {
    if (text.length <= account.maxChars) return [text];
    if (account.overflowPolicy === "stop") {
      throw new Error(`Yuanbao outbound text exceeds channel.options.maxChars (${account.maxChars})`);
    }
    return chunkMarkdownAware(text, account.maxChars);
  }

  private resolveReplyContextToken(input: {
    account: YuanbaoResolvedAccountConfig;
    routeKey: string;
    replyContextToken?: string;
  }): string | undefined {
    if (!input.replyContextToken || input.account.replyToMode === "off") return undefined;
    if (input.account.replyToMode === "all") return input.replyContextToken;
    const key = `${input.routeKey}:${input.replyContextToken}`;
    if (this.replyQuoteSent.has(key)) return undefined;
    this.replyQuoteSent.add(key);
    return input.replyContextToken;
  }

  /** Test/diagnostic helper. */
  getReplyQuoteCacheSizeForTests(): number {
    return this.replyQuoteSent.size();
  }

  private async sendTextChunks(input: {
    account: YuanbaoResolvedAccountConfig;
    chatType: "direct" | "group";
    target: string;
    text: string;
    replyContextToken?: string;
  }): Promise<void> {
    if (!this.gateway) throw new Error("YuanbaoChannel.start() must be called before delivery");
    const routeKey = buildYuanbaoChatKey(input.account.accountId, input.chatType, input.target);
    const chunks = this.splitText(input.account, input.text);
    for (const chunk of chunks) {
      if (this.isAborted()) return;
      await this.gateway.sendText({
        account: input.account,
        chatType: input.chatType,
        target: input.target,
        text: chunk,
        replyContextToken: this.resolveReplyContextToken({
          account: input.account,
          routeKey,
          replyContextToken: input.replyContextToken,
        }),
      });
    }
  }

  private createReplyHeartbeat(input: {
    account: YuanbaoResolvedAccountConfig;
    chatType: "direct" | "group";
    target: string;
    originalSenderAccount: string;
  }): { start: () => void; finish: () => void; stop: () => void } {
    let timer: ReturnType<typeof setInterval> | undefined;
    let started = false;
    const sendTime = Date.now();

    const send = (heartbeat: 1 | 2): void => {
      if (!this.gateway?.sendReplyHeartbeat) return;
      void this.gateway.sendReplyHeartbeat({
        account: input.account,
        chatType: input.chatType,
        target: input.target,
        originalSenderAccount: input.originalSenderAccount,
        heartbeat,
        sendTime,
      }).catch((error) => {
        void this.logger?.info("yuanbao.reply_heartbeat.failed", "failed to send yuanbao reply heartbeat", {
          error: error instanceof Error ? error.message : String(error),
        });
      });
    };

    const stop = (): void => {
      if (timer) {
        clearInterval(timer);
        timer = undefined;
      }
      started = false;
    };

    return {
      start: () => {
        if (started) return;
        started = true;
        send(REPLY_HEARTBEAT_RUNNING);
        timer = setInterval(() => send(REPLY_HEARTBEAT_RUNNING), REPLY_HEARTBEAT_INTERVAL_MS);
      },
      finish: () => {
        const wasStarted = started;
        stop();
        if (wasStarted) send(REPLY_HEARTBEAT_FINISH);
      },
      stop,
    };
  }

  private async handleInboundMessage(input: YuanbaoGatewayInboundMessage): Promise<void> {
    if (!this.agent || !this.quota || !this.logger || !this.gateway) {
      throw new Error("YuanbaoChannel.start() must initialize runtime before handling messages");
    }
    const account = this.accountById(input.accountId);
    if (!account || !account.enabled || !account.configured) return;
    const raw = input.raw;
    if (raw.callback_command && !raw.callback_command.endsWith("CallbackAfterSendMsg")) return;
    const fromAccount = raw.from_account?.trim();
    if (!fromAccount) return;
    if (input.isFromSelf || (account.botId && fromAccount === account.botId)) return;

    const target = input.chatType === "group" ? raw.group_code?.trim() : fromAccount;
    if (!target) return;

    const extracted = extractYuanbaoContent(raw.msg_body, account.botId);
    const isAtBot = input.isAtBot ?? extracted.isAtBot;
    if (!extracted.text.trim()) return;
    const knownCommand = this.agent.isKnownCommand?.(extracted.text) ?? false;
    if (input.chatType === "group" && account.requireMention && !isAtBot && !knownCommand) return;

    const chatKey = buildYuanbaoChatKey(account.accountId, input.chatType, target);
    const messageId = raw.msg_id || raw.msg_key || (raw.msg_seq !== undefined ? String(raw.msg_seq) : undefined);
    if (messageId && !this.dedup.tryRecord(messageId, chatKey)) {
      await this.logger.info("yuanbao.message.duplicate", "skipping duplicate yuanbao message", { messageId, chatKey });
      return;
    }

    if (this.isAborted()) return;

    const run = enqueueYuanbaoChatTask({
      chatKey,
      task: async () => {
        if (!this.agent || !this.quota || !this.gateway || !this.logger) return;
        if (this.isAborted()) return;
        this.quota.onInbound(chatKey);
        const heartbeat = this.createReplyHeartbeat({
          account,
          chatType: input.chatType,
          target,
          originalSenderAccount: fromAccount,
        });
        const queue = this.createTurnQueue({
          account,
          chatType: input.chatType,
          target,
          replyContextToken: messageId,
        });
        try {
          heartbeat.start();
          const response = await this.agent.chat({
            accountId: account.accountId,
            conversationId: chatKey,
            text: extracted.text,
            replyContextToken: messageId,
            ...(this.abortSignal ? { abortSignal: this.abortSignal } : {}),
            metadata: {
              channel: "yuanbao",
              chatType: input.chatType,
              senderId: fromAccount,
              ...(raw.sender_nickname ? { senderName: raw.sender_nickname } : {}),
              ...(input.chatType === "group" ? { groupId: target } : {}),
              isOwner: Boolean(raw.bot_owner_id && raw.from_account === raw.bot_owner_id),
            },
            reply: async (text) => {
              if (this.isAborted()) return;
              await queue.push(text);
            },
          });

          if (this.isAborted()) {
            queue.abort();
            return;
          }

          const responseText = response.text ?? "";
          if (responseText) await queue.push(responseText);
          const flushed = await queue.flush();
          let sentContent = flushed.sentContent;

          if (!sentContent && account.fallbackReply.trim() && !this.isAborted()) {
            const fallbackQueue = this.createTurnQueue({
              account,
              chatType: input.chatType,
              target,
              replyContextToken: messageId,
              forceStrategy: "immediate",
            });
            try {
              await fallbackQueue.push(account.fallbackReply);
              const r = await fallbackQueue.flush();
              sentContent = r.sentContent;
            } catch (error) {
              await this.logger.error("yuanbao.fallback.failed", "failed to send yuanbao fallback reply", {
                error: error instanceof Error ? error.message : String(error),
              });
            }
          }

          const media = normalizeMediaArray(response.media);
          if (media.length > 0) {
            await this.logger.error("yuanbao.media.unsupported", "yuanbao outbound media is not supported by the current gateway adapter", { count: media.length });
          }

          if (sentContent) heartbeat.finish();
          else heartbeat.stop();
        } catch (error) {
          queue.abort();
          heartbeat.stop();
          throw error;
        }
      },
    });
    await run.promise;
  }

  private createTurnQueue(input: {
    account: YuanbaoResolvedAccountConfig;
    chatType: "direct" | "group";
    target: string;
    replyContextToken?: string;
    forceStrategy?: OutboundQueueStrategy;
  }): ReturnType<typeof createOutboundQueueSession> {
    const account = input.account;
    const routeKey = buildYuanbaoChatKey(account.accountId, input.chatType, input.target);
    const strategy: OutboundQueueStrategy =
      input.forceStrategy
      ?? (account.disableBlockStreaming ? "merge-on-flush" : account.outboundQueueStrategy);
    return createOutboundQueueSession({
      strategy,
      minChars: account.minChars,
      maxChars: account.maxChars,
      idleMs: account.idleMs,
      isAborted: () => this.isAborted(),
      ...(this.deps.outboundSchedule ? { schedule: this.deps.outboundSchedule } : {}),
      chunkText: (text, maxChars) => {
        if (account.overflowPolicy === "stop" && text.length > maxChars) {
          throw new Error(`Yuanbao outbound text exceeds channel.options.maxChars (${maxChars})`);
        }
        return chunkMarkdownAware(text, maxChars);
      },
      sendText: async (text) => {
        if (!this.gateway) throw new Error("YuanbaoChannel.start() must be called before delivery");
        await this.gateway.sendText({
          account,
          chatType: input.chatType,
          target: input.target,
          text,
          replyContextToken: this.resolveReplyContextToken({
            account,
            routeKey,
            replyContextToken: input.replyContextToken,
          }),
        });
      },
    });
  }
}
