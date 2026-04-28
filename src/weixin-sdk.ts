export { login, start } from "./weixin/index.js";
export type { Agent, ChatRequest, ChatResponse } from "./weixin/index.js";
export type { LoginOptions, StartOptions } from "./weixin/index.js";

// Re-export new account management functions from the vendored SDK
export { resolveWeixinAccount, listWeixinAccountIds, clearAllWeixinAccounts, isLoggedIn, logout } from "./weixin/index.js";

interface WeixinSdkModule {
  login: () => Promise<string>;
  start: (
    agent: import("./weixin/index.js").Agent,
    options?: import("./weixin/index.js").StartOptions,
  ) => Promise<void>;
  isLoggedIn: () => boolean;
}

export async function loadWeixinSdk(): Promise<WeixinSdkModule> {
  const { login, start, isLoggedIn } = await import("./weixin/index.js");
  return { login, start, isLoggedIn };
}
