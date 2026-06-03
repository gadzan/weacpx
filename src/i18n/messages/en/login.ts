import type { LoginMessages } from "../../types";

export const login: LoginMessages = {
  // startWeixinLoginWithQr — existing session reused
  qrReady: "QR code is ready. Please scan it with WeChat.",

  // startWeixinLoginWithQr — new session started
  qrScanToConnect: "Scan the QR code below with WeChat to complete the connection.",

  // waitForWeixinLogin — no active login
  noActiveLogin: "No login in progress. Please initiate login first.",

  // waitForWeixinLogin — QR already expired before polling
  qrExpiredBeforeStart: "QR code has expired. Please generate a new one.",

  // waitForWeixinLogin — too many QR expiries
  loginTimeoutTooManyExpiries:
    "Login timed out: the QR code expired too many times. Please restart the login flow.",

  // refreshQRCode — new QR generated (written to stdout)
  newQrGenerated: "🔄 New QR code generated. Please scan again.\n\n",

  // refreshQRCode — browser fallback after successful generation
  qrBrowserFallback:
    "If the QR code is not displayed correctly, open the following link in a browser to scan:\n",

  // refreshQRCode — browser fallback when qrcode-terminal fails to load
  qrLoadFailed:
    "QR code failed to load. Open the following link in a browser to scan:\n",

  // refreshQRCode — refresh API call failed
  qrRefreshFailed: (detail: string) => `Failed to refresh QR code: ${detail}`,

  // waitForWeixinLogin — scanned status (written to stdout)
  scanned: "\n👀 QR code scanned. Continue in WeChat...\n",

  // waitForWeixinLogin — QR expired during polling (written to stdout)
  qrExpiringRefresh: (current: number, max: number) =>
    `\n⏳ QR code expired, refreshing... (${current}/${max})\n`,

  // waitForWeixinLogin — verify code: wrong input
  verifyCodeMismatch: "❌ The number you entered does not match. Please try again: ",

  // waitForWeixinLogin — verify code: first prompt
  verifyCodePrompt: "Enter the number shown on your WeChat mobile app to continue: ",

  // waitForWeixinLogin — verify code: no TTY available
  verifyCodeNoTty:
    "A pairing code is required but no interactive terminal is available. Run `xacpx login` in the foreground to complete login.",

  // waitForWeixinLogin — verify code blocked (written to stdout)
  verifyCodeBlocked: "\n⛔ Too many incorrect attempts. Please try again later.\n",

  // waitForWeixinLogin — verify code blocked, max retries reached
  verifyCodeBlockedStop:
    "Too many incorrect attempts. The connection flow has been stopped. Please try again later.",

  // waitForWeixinLogin — confirmed but missing ilink_bot_id
  loginMissingBotId: "Login failed: the server did not return ilink_bot_id.",

  // waitForWeixinLogin — confirmed success
  loginSuccess: "✅ Connected to WeChat successfully!",

  // waitForWeixinLogin — overall timeout
  loginTimeout: "Login timed out. Please try again.",

  // bot.login — starting
  startingLogin: "Starting WeChat QR code login...",

  // bot.login — scan instruction (printed before QR)
  scanInstruction: "\nScan the QR code below with WeChat to complete the connection:\n",

  // bot.login — QR link fallback (when qrcode-terminal not available)
  qrLinkFallback: (url: string) => `QR code URL: ${url}`,

  // bot.login — waiting for scan
  waitingForScan: "\nWaiting for scan...\n",

  // bot.login — overall success (printed after connect)
  loginSuccessLine: "\n✅ Connected to WeChat successfully!",

  // bot.logout — no accounts
  noAccountsLoggedIn: "No accounts are currently logged in.",

  // bot.logout — success
  logoutSuccess: "✅ Logged out.",

  // bot.start — no accounts (Error message)
  noAccountsError: "No logged-in accounts. Please run login first.",

  // bot.start — account not configured (Error message)
  accountNotConfigured: (accountId: string) =>
    `Account ${accountId} is not configured (missing token). Please run login first.`,
};
