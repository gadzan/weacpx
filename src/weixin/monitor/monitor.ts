import type { Agent } from "../agent/interface.js";
import { getUpdates } from "../api/api.js";
import { WeixinConfigManager } from "../api/config-cache.js";
import { SESSION_EXPIRED_ERRCODE, pauseSession, getRemainingPauseMs } from "../api/session-guard.js";
import { createConversationExecutor } from "../messaging/conversation-executor.js";
import { getWeixinMessageTurnLane, handleWeixinMessageTurn } from "../messaging/handle-weixin-message-turn.js";
import type { PendingFinalChunk } from "../messaging/quota-manager.js";
import { MessageItemType, type MessageItem } from "../api/types.js";
import { getSyncBufFilePath, loadGetUpdatesBuf, saveGetUpdatesBuf } from "../storage/sync-buf.js";
import { logger } from "../util/logger.js";
import { redactBody } from "../util/redact.js";

const DEFAULT_LONG_POLL_TIMEOUT_MS = 35_000;
const MAX_CONSECUTIVE_FAILURES = 3;
const BACKOFF_DELAY_MS = 30_000;
const RETRY_DELAY_MS = 2_000;

export type MonitorWeixinOpts = {
  baseUrl: string;
  cdnBaseUrl: string;
  token?: string;
  accountId: string;
  agent: Agent;
  abortSignal?: AbortSignal;
  longPollTimeoutMs?: number;
  log?: (msg: string) => void;
  onInbound?: (chatKey: string) => void;
  reserveFinal?: (chatKey: string) => boolean;
  // v1.4: pending-final pagination wiring. `dropPendingFinal` is fired
  // alongside `onInbound` when the inbound is anything OTHER than `/jx` —
  // this enforces the "user moved on, drop unfinished pages" policy.
  // `finalRemaining`, `hasPendingFinal`, `drainPendingFinal`, and
  // `enqueuePendingFinal` are forwarded into the message turn / slash command
  // pipeline so wave-sending and `/jx` drain can happen.
  finalRemaining?: (chatKey: string) => number;
  hasPendingFinal?: (chatKey: string) => boolean;
  drainPendingFinal?: (chatKey: string, available: number) => PendingFinalChunk[];
  prependPendingFinal?: (chatKey: string, chunks: PendingFinalChunk[]) => void;
  enqueuePendingFinal?: (chatKey: string, chunks: PendingFinalChunk[]) => void;
  dropPendingFinal?: (chatKey: string) => void;
};

function extractInboundText(itemList?: MessageItem[]): string {
  if (!itemList?.length) return "";
  for (const item of itemList) {
    if (item.type === MessageItemType.TEXT && item.text_item?.text != null) {
      return String(item.text_item.text);
    }
  }
  return "";
}

function parseSlashCommand(textBody: string): string | null {
  const trimmed = textBody.trim();
  if (!trimmed.startsWith("/")) return null;
  const spaceIdx = trimmed.indexOf(" ");
  return spaceIdx === -1 ? trimmed.toLowerCase() : trimmed.slice(0, spaceIdx).toLowerCase();
}

function shouldFetchTypingConfig(textBody: string): boolean {
  const command = parseSlashCommand(textBody);
  if (!command) return true;

  // These commands are fast local/control paths and intentionally do not show
  // typing. Skipping getConfig keeps control commands (especially /cancel and
  // /stop) from being blocked by a typing-ticket fetch before lane dispatch.
  //
  // /clear is deliberately NOT listed here: resetting/recreating a session can
  // take noticeable time, so handleWeixinMessageTurn wraps /clear with typing.
  return !["/cancel", "/stop", "/jx", "/echo", "/toggle-debug", "/logout"].includes(command);
}

/**
 * Long-poll loop: getUpdates → process message → call agent → send reply.
 * Runs until aborted.
 */
export async function monitorWeixinProvider(opts: MonitorWeixinOpts): Promise<void> {
  const {
    baseUrl,
    cdnBaseUrl,
    token,
    accountId,
    agent,
    abortSignal,
    longPollTimeoutMs,
  } = opts;
  const log = opts.log ?? ((msg: string) => console.log(msg));
  const errLog = (msg: string) => {
    log(msg);
    logger.error(msg);
  };
  const aLog = logger.withAccount(accountId);

  log(`[weixin] monitor started (${baseUrl}, account=${accountId})`);
  aLog.info(`Monitor started: baseUrl=${baseUrl}`);

  const syncFilePath = getSyncBufFilePath(accountId);
  const previousGetUpdatesBuf = loadGetUpdatesBuf(syncFilePath);
  let getUpdatesBuf = previousGetUpdatesBuf ?? "";

  if (previousGetUpdatesBuf) {
    log(`[weixin] resuming from previous sync buf (${getUpdatesBuf.length} bytes)`);
  } else {
    log(`[weixin] no previous sync buf, starting fresh`);
  }

  const configManager = new WeixinConfigManager({ baseUrl, token }, log);
  const conversationExecutor = createConversationExecutor();

  const seenMessageIds = new Set<number>();
  const messageIdOrder: number[] = [];
  const DEDUP_WINDOW = 100;

  let nextTimeoutMs = longPollTimeoutMs ?? DEFAULT_LONG_POLL_TIMEOUT_MS;
  let consecutiveFailures = 0;

  while (!abortSignal?.aborted) {
    try {
      const resp = await getUpdates({
        baseUrl,
        token,
        get_updates_buf: getUpdatesBuf,
        timeoutMs: nextTimeoutMs,
        abortSignal,
      });

      if (resp.longpolling_timeout_ms != null && resp.longpolling_timeout_ms > 0) {
        nextTimeoutMs = resp.longpolling_timeout_ms;
      }

      const isApiError =
        (resp.ret !== undefined && resp.ret !== 0) ||
        (resp.errcode !== undefined && resp.errcode !== 0);

      if (isApiError) {
        const isSessionExpired =
          resp.errcode === SESSION_EXPIRED_ERRCODE || resp.ret === SESSION_EXPIRED_ERRCODE;

        if (isSessionExpired) {
          pauseSession(accountId);
          const pauseMs = getRemainingPauseMs(accountId);
          errLog(
            `[weixin] session expired (errcode ${SESSION_EXPIRED_ERRCODE}), pausing for ${Math.ceil(pauseMs / 60_000)} min. Please run \`npx weixin-acp login\` to re-login.`,
          );
          consecutiveFailures = 0;
          await sleep(pauseMs, abortSignal);
          continue;
        }

        consecutiveFailures += 1;
        errLog(
          `[weixin] getUpdates failed: ret=${resp.ret} errcode=${resp.errcode} errmsg=${resp.errmsg ?? ""} (${consecutiveFailures}/${MAX_CONSECUTIVE_FAILURES})`,
        );
        if (consecutiveFailures >= MAX_CONSECUTIVE_FAILURES) {
          errLog(`[weixin] ${MAX_CONSECUTIVE_FAILURES} consecutive failures, backing off 30s`);
          consecutiveFailures = 0;
          await sleep(BACKOFF_DELAY_MS, abortSignal);
        } else {
          await sleep(RETRY_DELAY_MS, abortSignal);
        }
        continue;
      }

      consecutiveFailures = 0;

      if (resp.get_updates_buf != null && resp.get_updates_buf !== "") {
        saveGetUpdatesBuf(syncFilePath, resp.get_updates_buf);
        getUpdatesBuf = resp.get_updates_buf;
      }

      const list = resp.msgs ?? [];
      for (const full of list) {
        const msgId = full.message_id;
        if (msgId != null) {
          if (seenMessageIds.has(msgId)) {
            aLog.info(`duplicate message skipped: message_id=${msgId}`);
            continue;
          }
          seenMessageIds.add(msgId);
          messageIdOrder.push(msgId);
          if (messageIdOrder.length > DEDUP_WINDOW) {
            seenMessageIds.delete(messageIdOrder.shift()!);
          }
        }

        aLog.info(
          `inbound: from=${full.from_user_id} types=${full.item_list?.map((i) => i.type).join(",") ?? "none"}`,
        );

        const fromUserId = full.from_user_id ?? "";
        const inboundText = extractInboundText(full.item_list);
        const cachedConfig =
          fromUserId && shouldFetchTypingConfig(inboundText)
            ? await configManager.getForUser(fromUserId, full.context_token)
            : { typingTicket: "" };

        // Fire onInbound before lane queueing: a user reply during a long-running
        // prompt would otherwise sit behind the in-flight turn on the normal
        // lane, delaying quota reset until the prior task finishes — defeating
        // the heads-up "reply to continue" UX.
        //
        // v1.4: also drop pending paginated-final chunks unless the inbound is
        // `/jx` (the only command that drains pending). Doing this here in the
        // monitor — alongside onInbound, before lane queueing — keeps the
        // policy consistent with onInbound's "reset window immediately" intent.
        if (fromUserId) {
          opts.onInbound?.(fromUserId);
          if (opts.dropPendingFinal) {
            if (inboundText.trim().toLowerCase() !== "/jx") {
              opts.dropPendingFinal(fromUserId);
            }
          }
        }

        void conversationExecutor
          .run(full.from_user_id ?? "", getWeixinMessageTurnLane(full), () =>
            handleWeixinMessageTurn(full, {
              accountId,
              agent,
              baseUrl,
              cdnBaseUrl,
              token,
              typingTicket: cachedConfig.typingTicket,
              log,
              errLog,
              ...(opts.onInbound ? { onInbound: opts.onInbound } : {}),
              ...(opts.reserveFinal ? { reserveFinal: opts.reserveFinal } : {}),
              ...(opts.finalRemaining ? { finalRemaining: opts.finalRemaining } : {}),
              ...(opts.enqueuePendingFinal
                ? { enqueuePendingFinal: opts.enqueuePendingFinal }
                : {}),
              ...(opts.hasPendingFinal ? { hasPendingFinal: opts.hasPendingFinal } : {}),
              ...(opts.drainPendingFinal ? { drainPendingFinal: opts.drainPendingFinal } : {}),
              ...(opts.prependPendingFinal
                ? { prependPendingFinal: opts.prependPendingFinal }
                : {}),
            }),
          )
          .catch((err) => {
            errLog(`[weixin] message turn failed: ${String(err)}`);
          });
      }
    } catch (err) {
      if (abortSignal?.aborted) {
        aLog.info(`Monitor stopped (aborted)`);
        return;
      }
      consecutiveFailures += 1;
      errLog(
        `[weixin] getUpdates error (${consecutiveFailures}/${MAX_CONSECUTIVE_FAILURES}): ${String(err)}`,
      );
      if (consecutiveFailures >= MAX_CONSECUTIVE_FAILURES) {
        consecutiveFailures = 0;
        await sleep(BACKOFF_DELAY_MS, abortSignal);
      } else {
        await sleep(RETRY_DELAY_MS, abortSignal);
      }
    }
  }
  aLog.info(`Monitor ended`);
}

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    const t = setTimeout(resolve, ms);
    signal?.addEventListener(
      "abort",
      () => {
        clearTimeout(t);
        reject(new Error("aborted"));
      },
      { once: true },
    );
  });
}
