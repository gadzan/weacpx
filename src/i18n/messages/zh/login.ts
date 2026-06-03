import type { LoginMessages } from "../../types";

export const login: LoginMessages = {
  // startWeixinLoginWithQr — existing session reused
  qrReady: "二维码已就绪，请使用微信扫描。",

  // startWeixinLoginWithQr — new session started
  qrScanToConnect: "使用微信扫描以下二维码，以完成连接。",

  // waitForWeixinLogin — no active login
  noActiveLogin: "当前没有进行中的登录，请先发起登录。",

  // waitForWeixinLogin — QR already expired before polling
  qrExpiredBeforeStart: "二维码已过期，请重新生成。",

  // waitForWeixinLogin — too many QR expiries
  loginTimeoutTooManyExpiries: "登录超时：二维码多次过期，请重新开始登录流程。",

  // refreshQRCode — new QR generated (written to stdout)
  newQrGenerated: "🔄 新二维码已生成，请重新扫描\n\n",

  // refreshQRCode — browser fallback after successful generation
  qrBrowserFallback: "如果二维码未能成功展示，请用浏览器打开以下链接扫码：\n",

  // refreshQRCode — browser fallback when qrcode-terminal fails to load
  qrLoadFailed: "二维码未加载成功，请用浏览器打开以下链接扫码：\n",

  // refreshQRCode — refresh API call failed
  qrRefreshFailed: (detail: string) => `刷新二维码失败: ${detail}`,

  // waitForWeixinLogin — scanned status (written to stdout)
  scanned: "\n👀 已扫码，在微信继续操作...\n",

  // waitForWeixinLogin — QR expired during polling (written to stdout)
  qrExpiringRefresh: (current: number, max: number) =>
    `\n⏳ 二维码已过期，正在刷新...(${current}/${max})\n`,

  // waitForWeixinLogin — verify code: wrong input
  verifyCodeMismatch: "❌ 你输入的数字不匹配，请重新输入：",

  // waitForWeixinLogin — verify code: first prompt
  verifyCodePrompt: "输入手机微信显示的数字，以继续连接：",

  // waitForWeixinLogin — verify code: no TTY available
  verifyCodeNoTty:
    "需要输入配对码，但当前环境没有交互式终端。请在前台运行 `xacpx login` 完成登录。",

  // waitForWeixinLogin — verify code blocked (written to stdout)
  verifyCodeBlocked: "\n⛔ 多次输入错误，请稍后再试。\n",

  // waitForWeixinLogin — verify code blocked, max retries reached
  verifyCodeBlockedStop: "多次输入错误，连接流程已停止。请稍后再试。",

  // waitForWeixinLogin — confirmed but missing ilink_bot_id
  loginMissingBotId: "登录失败：服务器未返回 ilink_bot_id。",

  // waitForWeixinLogin — confirmed success
  loginSuccess: "✅ 与微信连接成功！",

  // waitForWeixinLogin — overall timeout
  loginTimeout: "登录超时，请重试。",

  // bot.login — starting
  startingLogin: "正在启动微信扫码登录...",

  // bot.login — scan instruction (printed before QR)
  scanInstruction: "\n使用微信扫描以下二维码，以完成连接：\n",

  // bot.login — QR link fallback (when qrcode-terminal not available)
  qrLinkFallback: (url: string) => `二维码链接: ${url}`,

  // bot.login — waiting for scan
  waitingForScan: "\n等待扫码...\n",

  // bot.login — overall success (printed after connect)
  loginSuccessLine: "\n✅ 与微信连接成功！",

  // bot.logout — no accounts
  noAccountsLoggedIn: "当前没有已登录的账号",

  // bot.logout — success
  logoutSuccess: "✅ 已退出登录",

  // bot.start — no accounts (Error message)
  noAccountsError: "没有已登录的账号，请先运行 login",

  // bot.start — account not configured (Error message)
  accountNotConfigured: (accountId: string) =>
    `账号 ${accountId} 未配置 (缺少 token)，请先运行 login`,
};
