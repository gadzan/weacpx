import qrcodeTerminal from "qrcode-terminal";

import { buildWeixinSdkSourceCandidates, loadWeixinSdk } from "./weixin-sdk";

interface WeixinAccountsModule {
  DEFAULT_BASE_URL: string;
  normalizeAccountId: (raw: string) => string;
  registerWeixinAccountId: (accountId: string) => void;
  saveWeixinAccount: (
    accountId: string,
    update: { token?: string; baseUrl?: string; userId?: string },
  ) => void;
}

interface WeixinLoginQrModule {
  DEFAULT_ILINK_BOT_TYPE: string;
  startWeixinLoginWithQr: (opts: {
    apiBaseUrl: string;
    botType?: string;
  }) => Promise<{
    qrcodeUrl?: string;
    message: string;
    sessionKey: string;
  }>;
  waitForWeixinLogin: (opts: {
    sessionKey: string;
    apiBaseUrl: string;
    timeoutMs?: number;
    botType?: string;
  }) => Promise<{
    connected: boolean;
    botToken?: string;
    accountId?: string;
    baseUrl?: string;
    userId?: string;
    message: string;
  }>;
}

async function loadQrLoginSupport(): Promise<{
  accounts: WeixinAccountsModule;
  loginQr: WeixinLoginQrModule;
} | null> {
  const candidates = buildWeixinSdkSourceCandidates(process.env.WEACPX_WEIXIN_SDK);

  for (const candidate of candidates) {
    try {
      const sourceUrl = candidate.startsWith("file:") ? candidate : new URL(candidate, import.meta.url).href;
      const accounts = (await import(new URL("./src/auth/accounts.ts", sourceUrl).href)) as WeixinAccountsModule;
      const loginQr = (await import(new URL("./src/auth/login-qr.ts", sourceUrl).href)) as WeixinLoginQrModule;
      return { accounts, loginQr };
    } catch {
      // Try the next source candidate.
    }
  }

  return null;
}

export async function loginWithQrRendering(): Promise<void> {
  const support = await loadQrLoginSupport();
  if (!support) {
    const { login } = await loadWeixinSdk();
    await login();
    return;
  }

  const { accounts, loginQr } = support;
  const apiBaseUrl = accounts.DEFAULT_BASE_URL;

  console.log("正在启动微信扫码登录...");
  const startResult = await loginQr.startWeixinLoginWithQr({
    apiBaseUrl,
    botType: loginQr.DEFAULT_ILINK_BOT_TYPE,
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

  const waitResult = await loginQr.waitForWeixinLogin({
    sessionKey: startResult.sessionKey,
    apiBaseUrl,
    timeoutMs: 480_000,
    botType: loginQr.DEFAULT_ILINK_BOT_TYPE,
  });

  if (!waitResult.connected || !waitResult.botToken || !waitResult.accountId) {
    throw new Error(waitResult.message);
  }

  const normalizedId = accounts.normalizeAccountId(waitResult.accountId);
  accounts.saveWeixinAccount(normalizedId, {
    token: waitResult.botToken,
    baseUrl: waitResult.baseUrl,
    userId: waitResult.userId,
  });
  accounts.registerWeixinAccountId(normalizedId);

  console.log("\n✅ 与微信连接成功！");
}

export async function main(): Promise<void> {
  await loginWithQrRendering();
}

if (import.meta.main) {
  await main();
}
