import { randomUUID } from "node:crypto";

import { apiGetFetch, apiPostFetch } from "../api/api.js";
import { listIndexedWeixinAccountIds, loadWeixinAccount } from "./accounts.js";
import { logger } from "../util/logger.js";
import { redactToken } from "../util/redact.js";
import { t } from "../../i18n/index.js";

type ActiveLogin = {
  sessionKey: string;
  id: string;
  qrcode: string;
  qrcodeUrl: string;
  startedAt: number;
  botToken?: string;
  status?:
    | "wait"
    | "scaned"
    | "confirmed"
    | "expired"
    | "scaned_but_redirect"
    | "need_verifycode"
    | "verify_code_blocked";
  error?: string;
  /** The current effective polling base URL; may be updated on IDC redirect. */
  currentApiBaseUrl?: string;
  /** The 6-digit pair code the user typed at the CLI; echoed on the next poll. */
  pendingVerifyCode?: string;
};

const ACTIVE_LOGIN_TTL_MS = 5 * 60_000;
/** Client-side timeout for the long-poll get_qrcode_status request. */
const QR_LONG_POLL_TIMEOUT_MS = 35_000;

/** Default `bot_type` for ilink get_bot_qrcode / get_qrcode_status (this channel build). */
export const DEFAULT_ILINK_BOT_TYPE = "3";

/** Fixed API base URL for all QR code requests. */
const FIXED_BASE_URL = "https://ilinkai.weixin.qq.com";

const activeLogins = new Map<string, ActiveLogin>();

interface QRCodeResponse {
  qrcode: string;
  qrcode_img_content: string;
}

interface StatusResponse {
  status:
    | "wait"
    | "scaned"
    | "confirmed"
    | "expired"
    | "scaned_but_redirect"
    | "need_verifycode"
    | "verify_code_blocked";
  bot_token?: string;
  ilink_bot_id?: string;
  baseurl?: string;
  /** The user ID of the person who scanned the QR code. */
  ilink_user_id?: string;
  /** New host to redirect polling to when status is scaned_but_redirect. */
  redirect_host?: string;
}

function isLoginFresh(login: ActiveLogin): boolean {
  return Date.now() - login.startedAt < ACTIVE_LOGIN_TTL_MS;
}

/** Remove all expired entries from the activeLogins map to prevent memory leaks. */
function purgeExpiredLogins(): void {
  for (const [id, login] of activeLogins) {
    if (!isLoginFresh(login)) {
      activeLogins.delete(id);
    }
  }
}

function getLocalBotTokenList(): string[] {
  const accountIds = listIndexedWeixinAccountIds();
  const tokens: string[] = [];
  for (let i = accountIds.length - 1; i >= 0 && tokens.length < 10; i--) {
    const accountId = accountIds[i];
    if (!accountId) continue;
    const data = loadWeixinAccount(accountId);
    const token = data?.token?.trim();
    if (token) {
      tokens.push(token);
    }
  }
  return tokens;
}

async function fetchQRCode(apiBaseUrl: string, botType: string): Promise<QRCodeResponse> {
  logger.info(`Fetching QR code from: ${apiBaseUrl} bot_type=${botType}`);
  const localTokenList = getLocalBotTokenList();
  logger.info(`fetchQRCode: local_token_list count=${localTokenList.length}`);
  const rawText = await apiPostFetch({
    baseUrl: apiBaseUrl,
    endpoint: `ilink/bot/get_bot_qrcode?bot_type=${encodeURIComponent(botType)}`,
    body: JSON.stringify({ local_token_list: localTokenList }),
    label: "fetchQRCode",
  });
  return JSON.parse(rawText) as QRCodeResponse;
}

/**
 * Build the URL-encoded endpoint for the QR status long-poll. Exported for
 * unit testing — `pollQRStatus` uses this exact helper, so a test on the
 * helper covers the real production path.
 */
export function buildPollQRStatusEndpoint(qrcode: string, verifyCode?: string): string {
  let endpoint = `ilink/bot/get_qrcode_status?qrcode=${encodeURIComponent(qrcode)}`;
  if (verifyCode) {
    endpoint += `&verify_code=${encodeURIComponent(verifyCode)}`;
  }
  return endpoint;
}

async function pollQRStatus(
  apiBaseUrl: string,
  qrcode: string,
  verifyCode?: string,
): Promise<StatusResponse> {
  logger.debug(`Long-poll QR status from: ${apiBaseUrl} qrcode=*** hasVerifyCode=${Boolean(verifyCode)}`);
  const endpoint = buildPollQRStatusEndpoint(qrcode, verifyCode);
  try {
    const rawText = await apiGetFetch({
      baseUrl: apiBaseUrl,
      endpoint,
      timeoutMs: QR_LONG_POLL_TIMEOUT_MS,
      label: "pollQRStatus",
    });
    logger.debug(`pollQRStatus: body=${rawText.substring(0, 200)}`);
    return JSON.parse(rawText) as StatusResponse;
  } catch (err) {
    if (err instanceof Error && err.name === "AbortError") {
      logger.debug(`pollQRStatus: client-side timeout after ${QR_LONG_POLL_TIMEOUT_MS}ms, returning wait`);
      return { status: "wait" };
    }
    // 网关超时（如 Cloudflare 524）或其他网络错误，视为等待状态继续轮询
    logger.warn(`pollQRStatus: network/gateway error, will retry: ${String(err)}`);
    return { status: "wait" };
  }
}

/** Read a single line from stdin after writing a prompt; returns the trimmed input. */
async function readVerifyCodeFromStdin(prompt: string): Promise<string> {
  if (!process.stdin.isTTY) {
    throw new Error("verify code requested but stdin is not a TTY (running in daemon mode?)");
  }
  process.stdout.write(prompt);
  return new Promise((resolve) => {
    let input = "";
    const onData = (chunk: Buffer | string) => {
      const str = chunk.toString();
      input += str;
      if (input.includes("\n")) {
        process.stdin.removeListener("data", onData);
        process.stdin.pause();
        resolve(input.trim());
      }
    };
    process.stdin.resume();
    process.stdin.setEncoding("utf-8");
    process.stdin.on("data", onData);
  });
}

export type WeixinQrStartResult = {
  qrcodeUrl?: string;
  message: string;
  sessionKey: string;
};

export type WeixinQrWaitResult = {
  connected: boolean;
  botToken?: string;
  accountId?: string;
  baseUrl?: string;
  /** The user ID of the person who scanned the QR code; add to allowFrom. */
  userId?: string;
  message: string;
};

export async function startWeixinLoginWithQr(opts: {
  verbose?: boolean;
  timeoutMs?: number;
  force?: boolean;
  accountId?: string;
  apiBaseUrl: string;
  botType?: string;
}): Promise<WeixinQrStartResult> {
  const sessionKey = opts.accountId || randomUUID();

  purgeExpiredLogins();

  const existing = activeLogins.get(sessionKey);
  if (!opts.force && existing && isLoginFresh(existing) && existing.qrcodeUrl) {
    return {
      qrcodeUrl: existing.qrcodeUrl,
      message: t().login.qrReady,
      sessionKey,
    };
  }

  try {
    const botType = opts.botType || DEFAULT_ILINK_BOT_TYPE;
    logger.info(`Starting Weixin login with bot_type=${botType}`);

    const qrResponse = await fetchQRCode(FIXED_BASE_URL, botType);
    logger.info(
      `QR code received, qrcode=${redactToken(qrResponse.qrcode)} imgContentLen=${qrResponse.qrcode_img_content?.length ?? 0}`,
    );
    logger.info(`二维码链接: ${qrResponse.qrcode_img_content}`);

    const login: ActiveLogin = {
      sessionKey,
      id: randomUUID(),
      qrcode: qrResponse.qrcode,
      qrcodeUrl: qrResponse.qrcode_img_content,
      startedAt: Date.now(),
    };

    activeLogins.set(sessionKey, login);

    return {
      qrcodeUrl: qrResponse.qrcode_img_content,
      message: t().login.qrScanToConnect,
      sessionKey,
    };
  } catch (err) {
    logger.error(`Failed to start Weixin login: ${String(err)}`);
    return {
      message: `Failed to start login: ${String(err)}`,
      sessionKey,
    };
  }
}

const MAX_QR_REFRESH_COUNT = 3;

/**
 * Fetch a fresh QR code, update the given activeLogin in place, render the QR
 * to the terminal, and invoke onScannedReset so the caller can clear any
 * "已扫码" indicator. Shared by the `expired` and `verify_code_blocked` cases.
 */
async function refreshQRCode(
  activeLogin: ActiveLogin,
  botType: string,
  qrRefreshCount: number,
  onScannedReset: () => void,
): Promise<{ success: true } | { success: false; message: string }> {
  try {
    const qrResponse = await fetchQRCode(FIXED_BASE_URL, botType);
    activeLogin.qrcode = qrResponse.qrcode;
    activeLogin.qrcodeUrl = qrResponse.qrcode_img_content;
    activeLogin.startedAt = Date.now();
    onScannedReset();
    logger.info(
      `refreshQRCode: new QR code obtained (${qrRefreshCount}/${MAX_QR_REFRESH_COUNT}) qrcode=${redactToken(qrResponse.qrcode)}`,
    );
    process.stdout.write(t().login.newQrGenerated);
    try {
      const qrterm = await import("qrcode-terminal");
      qrterm.default.generate(qrResponse.qrcode_img_content, { small: true });
      process.stdout.write(t().login.qrBrowserFallback);
      process.stdout.write(`${qrResponse.qrcode_img_content}\n`);
    } catch {
      process.stdout.write(t().login.qrLoadFailed);
      process.stdout.write(`${qrResponse.qrcode_img_content}\n`);
    }
    return { success: true };
  } catch (refreshErr) {
    logger.error(`refreshQRCode: failed to refresh QR code: ${String(refreshErr)}`);
    return { success: false, message: t().login.qrRefreshFailed(String(refreshErr)) };
  }
}

export async function waitForWeixinLogin(opts: {
  timeoutMs?: number;
  verbose?: boolean;
  sessionKey: string;
  apiBaseUrl: string;
  botType?: string;
}): Promise<WeixinQrWaitResult> {
  let activeLogin = activeLogins.get(opts.sessionKey);

  if (!activeLogin) {
    logger.warn(`waitForWeixinLogin: no active login sessionKey=${opts.sessionKey}`);
    return {
      connected: false,
      message: t().login.noActiveLogin,
    };
  }

  if (!isLoginFresh(activeLogin)) {
    logger.warn(`waitForWeixinLogin: login QR expired sessionKey=${opts.sessionKey}`);
    activeLogins.delete(opts.sessionKey);
    return {
      connected: false,
      message: t().login.qrExpiredBeforeStart,
    };
  }

  const timeoutMs = Math.max(opts.timeoutMs ?? 480_000, 1000);
  const deadline = Date.now() + timeoutMs;
  let scannedPrinted = false;
  let qrRefreshCount = 1;

  // Initialize the effective polling base URL; may be updated on IDC redirect.
  activeLogin.currentApiBaseUrl = FIXED_BASE_URL;

  logger.info("Starting to poll QR code status...");

  while (Date.now() < deadline) {
    try {
      const currentBaseUrl = activeLogin.currentApiBaseUrl ?? FIXED_BASE_URL;
      const statusResponse = await pollQRStatus(
        currentBaseUrl,
        activeLogin.qrcode,
        activeLogin.pendingVerifyCode,
      );
      logger.debug(`pollQRStatus: status=${statusResponse.status} hasBotToken=${Boolean(statusResponse.bot_token)} hasBotId=${Boolean(statusResponse.ilink_bot_id)}`);
      activeLogin.status = statusResponse.status;

      switch (statusResponse.status) {
        case "wait":
          if (opts.verbose) {
            process.stdout.write(".");
          }
          break;
        case "scaned":
          if (activeLogin.pendingVerifyCode) {
            logger.info("verify code accepted, resuming polling");
            activeLogin.pendingVerifyCode = undefined;
          }
          if (!scannedPrinted) {
            process.stdout.write(t().login.scanned);
            scannedPrinted = true;
          }
          break;
        case "expired": {
          activeLogin.pendingVerifyCode = undefined;
          qrRefreshCount++;
          if (qrRefreshCount > MAX_QR_REFRESH_COUNT) {
            logger.warn(
              `waitForWeixinLogin: QR expired ${MAX_QR_REFRESH_COUNT} times, giving up sessionKey=${opts.sessionKey}`,
            );
            activeLogins.delete(opts.sessionKey);
            return {
              connected: false,
              message: t().login.loginTimeoutTooManyExpiries,
            };
          }

          process.stdout.write(t().login.qrExpiringRefresh(qrRefreshCount, MAX_QR_REFRESH_COUNT));
          logger.info(
            `waitForWeixinLogin: QR expired, refreshing (${qrRefreshCount}/${MAX_QR_REFRESH_COUNT})`,
          );

          const expiredRefreshResult = await refreshQRCode(
            activeLogin,
            opts.botType || DEFAULT_ILINK_BOT_TYPE,
            qrRefreshCount,
            () => {
              scannedPrinted = false;
            },
          );
          if (!expiredRefreshResult.success) {
            activeLogins.delete(opts.sessionKey);
            return {
              connected: false,
              message: expiredRefreshResult.message,
            };
          }
          break;
        }
        case "scaned_but_redirect": {
          const redirectHost = statusResponse.redirect_host;
          if (redirectHost) {
            const newBaseUrl = `https://${redirectHost}`;
            activeLogin.currentApiBaseUrl = newBaseUrl;
            logger.info(`waitForWeixinLogin: IDC redirect, switching polling host to ${redirectHost}`);
          } else {
            logger.warn(`waitForWeixinLogin: received scaned_but_redirect but redirect_host is missing, continuing with current host`);
          }
          break;
        }
        case "need_verifycode": {
          const verifyPrompt = activeLogin.pendingVerifyCode
            ? t().login.verifyCodeMismatch
            : t().login.verifyCodePrompt;
          let code: string;
          try {
            code = await readVerifyCodeFromStdin(verifyPrompt);
          } catch (err) {
            logger.error(`waitForWeixinLogin: cannot read verify code (no TTY): ${String(err)}`);
            activeLogins.delete(opts.sessionKey);
            return {
              connected: false,
              message: t().login.verifyCodeNoTty,
            };
          }
          activeLogin.pendingVerifyCode = code;
          continue; // skip the 1s sleep; poll immediately with new code
        }
        case "verify_code_blocked": {
          logger.warn(
            `waitForWeixinLogin: verify code blocked, qrRefreshCount=${qrRefreshCount} sessionKey=${opts.sessionKey}`,
          );
          process.stdout.write(t().login.verifyCodeBlocked);
          activeLogin.pendingVerifyCode = undefined;
          qrRefreshCount++;
          if (qrRefreshCount > MAX_QR_REFRESH_COUNT) {
            logger.warn(
              `waitForWeixinLogin: verify_code_blocked and QR refresh limit reached, giving up sessionKey=${opts.sessionKey}`,
            );
            activeLogins.delete(opts.sessionKey);
            return {
              connected: false,
              message: t().login.verifyCodeBlockedStop,
            };
          }
          const blockedRefreshResult = await refreshQRCode(
            activeLogin,
            opts.botType || DEFAULT_ILINK_BOT_TYPE,
            qrRefreshCount,
            () => {
              scannedPrinted = false;
            },
          );
          if (!blockedRefreshResult.success) {
            activeLogins.delete(opts.sessionKey);
            return {
              connected: false,
              message: blockedRefreshResult.message,
            };
          }
          break;
        }
        case "confirmed": {
          if (!statusResponse.ilink_bot_id) {
            activeLogins.delete(opts.sessionKey);
            logger.error("Login confirmed but ilink_bot_id missing from response");
            return {
              connected: false,
              message: t().login.loginMissingBotId,
            };
          }

          activeLogin.botToken = statusResponse.bot_token;
          activeLogins.delete(opts.sessionKey);

          logger.info(
            `✅ Login confirmed! ilink_bot_id=${statusResponse.ilink_bot_id} ilink_user_id=${redactToken(statusResponse.ilink_user_id)}`,
          );

          return {
            connected: true,
            botToken: statusResponse.bot_token,
            accountId: statusResponse.ilink_bot_id,
            baseUrl: statusResponse.baseurl,
            userId: statusResponse.ilink_user_id,
            message: t().login.loginSuccess,
          };
        }
      }

    } catch (err) {
      logger.error(`Error polling QR status: ${String(err)}`);
      activeLogins.delete(opts.sessionKey);
      return {
        connected: false,
        message: `Login failed: ${String(err)}`,
      };
    }

    await new Promise((r) => setTimeout(r, 1000));
  }

  logger.warn(
    `waitForWeixinLogin: timed out waiting for QR scan sessionKey=${opts.sessionKey} timeoutMs=${timeoutMs}`,
  );
  activeLogins.delete(opts.sessionKey);
  return {
    connected: false,
    message: t().login.loginTimeout,
  };
}
