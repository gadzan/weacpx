export type { Agent, ChatRequest, ChatResponse } from "./agent/interface.js";
export { login, start, logout, isLoggedIn } from "./bot.js";
export type { LoginOptions, StartOptions } from "./bot.js";

// Internal exports needed by weacpx for streaming reply
export { sendMessageWeixin, markdownToPlainText } from "./messaging/send.js";
export { getContextToken } from "./messaging/inbound.js";
export { resolveWeixinAccount, listWeixinAccountIds, clearAllWeixinAccounts } from "./auth/accounts.js";
