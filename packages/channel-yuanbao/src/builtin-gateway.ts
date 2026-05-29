import type { AppLogger } from "weacpx/plugin-api";
import type { YuanbaoResolvedAccountConfig } from "./config.js";
import type {
  YuanbaoGateway,
  YuanbaoGatewayInboundMessage,
  YuanbaoGatewayReplyHeartbeatInput,
  YuanbaoGatewaySendTextInput,
  YuanbaoGatewayStartInput,
  YuanbaoInboundMessage,
  YuanbaoMsgBodyElement,
} from "./types.js";
import { decodeInboundMessage } from "./access/ws/biz-codec.js";
import { toSyncInformationData } from "./command-sync.js";
import { YuanbaoWsClient } from "./access/ws/client.js";
import type { WsConnectionConfig, WsPushEvent } from "./access/ws/types.js";
import { getYuanbaoSignToken, refreshYuanbaoSignToken } from "./sign-token.js";

type PushDecodeResult = {
  msg: YuanbaoInboundMessage;
  chatType: "direct" | "group";
};

function textBody(text: string): YuanbaoMsgBodyElement[] {
  return [{ msg_type: "TIMTextElem", msg_content: { text } }];
}

function inferChatType(raw: YuanbaoInboundMessage): "direct" | "group" {
  if (raw.group_code) return "group";
  if (raw.callback_command?.startsWith("Group.")) return "group";
  return "direct";
}

function logContext(context: Record<string, unknown> | undefined) {
  return context as Parameters<AppLogger["info"]>[2];
}

function hasMessageFields(value: unknown): boolean {
  if (!value || typeof value !== "object") return false;
  const record = value as Record<string, unknown>;
  return Boolean(record.callback_command || record.from_account || record.msg_body);
}

function parsePushContentToMessage(content: unknown): PushDecodeResult | null {
  if (typeof content !== "string" || !content.trim()) return null;

  try {
    const parsed = JSON.parse(content) as Record<string, unknown>;
    if (hasMessageFields(parsed)) {
      const msg = parsed as YuanbaoInboundMessage;
      return { msg, chatType: inferChatType(msg) };
    }
    if (typeof parsed.text === "string" && parsed.text.trim()) {
      const msg: YuanbaoInboundMessage = {
        callback_command: parsed.group_code ? "Group.CallbackAfterSendMsg" : "C2C.CallbackAfterSendMsg",
        from_account: typeof parsed.from_account === "string" ? parsed.from_account : undefined,
        group_code: typeof parsed.group_code === "string" ? parsed.group_code : undefined,
        msg_body: textBody(parsed.text),
      };
      return { msg, chatType: inferChatType(msg) };
    }
  } catch {
    // Plain text content is still a valid direct push fallback.
  }

  return {
    msg: {
      callback_command: "C2C.CallbackAfterSendMsg",
      msg_body: textBody(content),
    },
    chatType: "direct",
  };
}

function decodeJsonMessage(data: Uint8Array): PushDecodeResult | null {
  try {
    const parsed = JSON.parse(new TextDecoder().decode(data)) as unknown;
    if (!hasMessageFields(parsed)) return null;
    const msg = parsed as YuanbaoInboundMessage;
    return { msg, chatType: inferChatType(msg) };
  } catch {
    return null;
  }
}

export function decodeYuanbaoWsPush(push: WsPushEvent): PushDecodeResult | null {
  if (push.connData && push.connData.length > 0) {
    const decoded = decodeInboundMessage(push.connData);
    if (decoded) return { msg: decoded, chatType: inferChatType(decoded) };
  }

  if (push.rawData && push.rawData.length > 0) {
    const decoded = decodeInboundMessage(push.rawData);
    if (decoded) return { msg: decoded, chatType: inferChatType(decoded) };
    const json = decodeJsonMessage(push.rawData);
    if (json) return json;
  }

  return parsePushContentToMessage(push.content);
}

async function resolveWsAuth(
  account: YuanbaoResolvedAccountConfig,
  logger: AppLogger,
  abortSignal: AbortSignal,
): Promise<WsConnectionConfig["auth"]> {
  const token = await getYuanbaoSignToken(account, logger, { abortSignal });
  if (token.bot_id) account.botId = token.bot_id;
  return {
    bizId: "ybBot",
    uid: token.bot_id || account.botId || "",
    source: token.source || "bot",
    token: token.token,
  };
}

export class BuiltinYuanbaoGateway implements YuanbaoGateway {
  private readonly clients = new Map<string, YuanbaoWsClient>();
  private stopResolve: (() => void) | null = null;

  async start(input: YuanbaoGatewayStartInput): Promise<void> {
    const onAbort = () => this.stop();
    input.abortSignal.addEventListener("abort", onAbort, { once: true });

    try {
      for (const account of input.accounts) {
        if (input.abortSignal.aborted) return;
        const auth = await resolveWsAuth(account, input.logger, input.abortSignal);
        if (input.abortSignal.aborted) return;
        const client = new YuanbaoWsClient({
          connection: {
            gatewayUrl: account.wsUrl,
            auth,
          },
          callbacks: {
            onReady: (data) => {
              void input.logger.info("yuanbao.ws.ready", "yuanbao websocket ready", {
                accountId: account.accountId,
                connectId: data.connectId,
              });
              const sync = input.commandSync;
              if (sync && sync.botCommands.length > 0) {
                const readyClient = this.clients.get(account.accountId);
                void readyClient
                  ?.syncInformation(toSyncInformationData(sync))
                  .then((rsp) =>
                    input.logger.info("yuanbao.ws.sync_commands", "synced command hints", {
                      accountId: account.accountId,
                      code: rsp.code,
                      count: sync.botCommands.length,
                    }),
                  )
                  .catch((err) =>
                    input.logger.error("yuanbao.ws.sync_commands_failed", "command hint sync failed", {
                      accountId: account.accountId,
                      message: err instanceof Error ? err.message : String(err),
                    }),
                  );
              }
            },
            onDispatch: (push) => {
              void this.handleDispatch(account, push, input.onMessage, input.logger);
            },
            onStateChange: (state) => {
              void input.logger.info("yuanbao.ws.state", "yuanbao websocket state changed", {
                accountId: account.accountId,
                state,
              });
            },
            onError: (error) => {
              void input.logger.error("yuanbao.ws.error", "yuanbao websocket error", {
                accountId: account.accountId,
                message: error.message,
              });
            },
            onClose: (code, reason) => {
              void input.logger.info("yuanbao.ws.closed", "yuanbao websocket closed", {
                accountId: account.accountId,
                code,
                reason,
              });
            },
            onKickout: (data) => {
              void input.logger.error("yuanbao.ws.kickout", "yuanbao websocket kicked out", {
                accountId: account.accountId,
                status: data.status,
                reason: data.reason,
              });
            },
            onAuthFailed: async () => {
              const token = await refreshYuanbaoSignToken(account, input.logger, { abortSignal: input.abortSignal });
              if (token.bot_id) account.botId = token.bot_id;
              return {
                bizId: "ybBot",
                uid: token.bot_id || account.botId || "",
                source: token.source || "bot",
                token: token.token,
              };
            },
          },
          log: {
            info: (msg, context) => { void input.logger.info("yuanbao.ws.info", msg, logContext(context)); },
            warn: (msg, context) => { void input.logger.info("yuanbao.ws.warn", msg, logContext(context)); },
            error: (msg, context) => { void input.logger.error("yuanbao.ws.error", msg, logContext(context)); },
            debug: (msg, context) => { void input.logger.debug("yuanbao.ws.debug", msg, logContext(context)); },
          },
        });
        this.clients.set(account.accountId, client);
        client.connect();
      }

      if (input.abortSignal.aborted) return;

      await new Promise<void>((resolve) => {
        this.stopResolve = resolve;
        if (input.abortSignal.aborted) this.stop();
      });
    } catch (error) {
      this.stop();
      if (input.abortSignal.aborted) return;
      throw error;
    } finally {
      input.abortSignal.removeEventListener("abort", onAbort);
    }
  }

  async sendText(input: YuanbaoGatewaySendTextInput): Promise<{ messageId?: string }> {
    const client = this.clients.get(input.account.accountId);
    if (!client) throw new Error(`Yuanbao gateway is not connected for account: ${input.account.accountId}`);

    const body = textBody(input.text);
    if (input.chatType === "group") {
      const result = await client.sendGroupMessage({
        group_code: input.target,
        msg_body: body,
        ...(input.account.botId ? { from_account: input.account.botId } : {}),
        ...(input.replyContextToken ? { msg_id: input.replyContextToken, ref_msg_id: input.replyContextToken } : {}),
      });
      if (result.code !== 0) throw new Error(result.message || `Yuanbao group send failed: code=${result.code}`);
      return { messageId: result.msgId };
    }

    const result = await client.sendC2CMessage({
      to_account: input.target,
      msg_body: body,
      msg_random: Math.floor(Math.random() * 4294967295),
      ...(input.account.botId ? { from_account: input.account.botId } : {}),
    });
    if (result.code !== 0) throw new Error(result.message || `Yuanbao direct send failed: code=${result.code}`);
    return { messageId: result.msgId };
  }

  async sendReplyHeartbeat(input: YuanbaoGatewayReplyHeartbeatInput): Promise<void> {
    const client = this.clients.get(input.account.accountId);
    if (!client) throw new Error(`Yuanbao gateway is not connected for account: ${input.account.accountId}`);
    const botAccount = input.account.botId?.trim();
    if (!botAccount) return;
    if (input.chatType === "group") {
      const result = await client.sendGroupHeartbeat({
        from_account: botAccount,
        to_account: input.originalSenderAccount,
        group_code: input.target,
        send_time: input.sendTime,
        heartbeat: input.heartbeat,
      });
      if (result.code !== 0) throw new Error(result.msg || result.message || `Yuanbao group heartbeat failed: code=${result.code}`);
      return;
    }

    const result = await client.sendPrivateHeartbeat({
      from_account: botAccount,
      to_account: input.target,
      heartbeat: input.heartbeat,
    });
    if (result.code !== 0) throw new Error(result.msg || result.message || `Yuanbao direct heartbeat failed: code=${result.code}`);
  }

  stop(): void {
    for (const client of this.clients.values()) {
      client.disconnect();
    }
    this.clients.clear();
    this.stopResolve?.();
    this.stopResolve = null;
  }

  private async handleDispatch(
    account: YuanbaoResolvedAccountConfig,
    push: WsPushEvent,
    onMessage: (message: YuanbaoGatewayInboundMessage) => Promise<void>,
    logger: AppLogger,
  ): Promise<void> {
    try {
      const decoded = decodeYuanbaoWsPush(push);
      if (!decoded) return;
      await onMessage({
        accountId: account.accountId,
        chatType: decoded.chatType,
        raw: decoded.msg,
        isFromSelf: Boolean(account.botId && decoded.msg.from_account === account.botId),
      });
    } catch (error) {
      await logger.error("yuanbao.ws.dispatch_failed", "failed to handle yuanbao websocket push", {
        accountId: account.accountId,
        message: error instanceof Error ? error.message : String(error),
      });
    }
  }
}

export function createBuiltinYuanbaoGateway(): YuanbaoGateway {
  return new BuiltinYuanbaoGateway();
}
