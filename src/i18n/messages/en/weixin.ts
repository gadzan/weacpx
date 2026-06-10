import type { WeixinMessages } from "../../types";

export const weixin: WeixinMessages = {
  // handleEcho — timing block header and rows
  echoTimingHeader: "⏱ Channel latency",
  echoTimingEventTime: (iso: string) => `├ Event time: ${iso}`,
  echoTimingPlatformDelay: (delay: string) => `├ Platform→plugin: ${delay}`,
  echoTimingPluginDelay: (ms: number) => `└ Plugin processing: ${ms}ms`,

  // /toggle-debug
  debugEnabled: "Debug mode enabled",
  debugDisabled: "Debug mode disabled",

  // /clear
  sessionCleared: "✅ Session cleared. Starting a fresh conversation.",

  // handleSlashCommand — command execution error
  commandFailed: (detail: string) => `❌ Command failed: ${detail}`,
};
