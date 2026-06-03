import qrcodeTerminal from "qrcode-terminal";

import {
  DEFAULT_BASE_URL,
  normalizeAccountId,
  registerWeixinAccountId,
  saveWeixinAccount,
} from "./weixin/auth/accounts.js";
import {
  DEFAULT_ILINK_BOT_TYPE,
  startWeixinLoginWithQr,
  waitForWeixinLogin,
} from "./weixin/auth/login-qr.js";
import { t } from "./i18n/index.js";

export async function loginWithQrRendering(): Promise<void> {
  const apiBaseUrl = DEFAULT_BASE_URL;

  console.log(t().login.startingLogin);
  const startResult = await startWeixinLoginWithQr({
    apiBaseUrl,
    botType: DEFAULT_ILINK_BOT_TYPE,
  });

  if (!startResult.qrcodeUrl) {
    throw new Error(startResult.message);
  }

  console.log(t().login.scanInstruction);
  await new Promise<void>((resolve) => {
    qrcodeTerminal.generate(startResult.qrcodeUrl!, { small: true }, (qr) => {
      console.log(qr);
      resolve();
    });
  });

  console.log(t().login.waitingForScan);

  const waitResult = await waitForWeixinLogin({
    sessionKey: startResult.sessionKey,
    apiBaseUrl,
    timeoutMs: 480_000,
    botType: DEFAULT_ILINK_BOT_TYPE,
  });

  if (!waitResult.connected || !waitResult.botToken || !waitResult.accountId) {
    throw new Error(waitResult.message);
  }

  const normalizedId = normalizeAccountId(waitResult.accountId);
  saveWeixinAccount(normalizedId, {
    token: waitResult.botToken,
    baseUrl: waitResult.baseUrl,
    userId: waitResult.userId,
  });
  registerWeixinAccountId(normalizedId);

  console.log(t().login.loginSuccessLine);
}

export async function main(): Promise<void> {
  await loginWithQrRendering();
}

if (import.meta.main) {
  await main();
}
