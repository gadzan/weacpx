import type { WeixinMessages } from "../../types";

export const weixin: WeixinMessages = {
  // handleEcho — timing block header and rows
  echoTimingHeader: "⏱ 通道耗时",
  echoTimingEventTime: (iso: string) => `├ 事件时间: ${iso}`,
  echoTimingPlatformDelay: (delay: string) => `├ 平台→插件: ${delay}`,
  echoTimingPluginDelay: (ms: number) => `└ 插件处理: ${ms}ms`,

  // /toggle-debug
  debugEnabled: "Debug 模式已开启",
  debugDisabled: "Debug 模式已关闭",

  // /clear
  sessionCleared: "✅ 会话已清除，重新开始对话",

  // /logout — no accounts
  noAccountsLoggedIn: "当前没有已登录的账号",

  // /logout — success
  logoutSuccess: "✅ 已退出登录，清除所有账号凭证",

  // handleSlashCommand — command execution error
  commandFailed: (detail: string) => `❌ 指令执行失败: ${detail}`,
};
