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
export async function loginWithQrRendering(): Promise<void> {
  const apiBaseUrl = DEFAULT_BASE_URL;

  console.log("正在启动微信扫码登录...");
  const startResult = await startWeixinLoginWithQr({
    apiBaseUrl,
    botType: DEFAULT_ILINK_BOT_TYPE,
  });

  if (!startResult.qrcodeUrl) {
    throw new Error(startResult.message);
  }

  console.log("\n使用微信扫描以下二维码，以完成连接：\n");
  await new Promise<void>((resolve) => {
    qrcodeTerminal.generate(startResult.qrcodeUrl!, { small: true }, (qr) => {
      console.log(qr);
      resolve();
    });
  });

  console.log("\n等待扫码...\n");

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

  console.log("\n✅ 与微信连接成功！");
}

export async function main(): Promise<void> {
  await loginWithQrRendering();
}

if (import.meta.main) {
  await main();
}
