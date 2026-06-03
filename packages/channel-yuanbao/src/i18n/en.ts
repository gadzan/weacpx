import type { YuanbaoMessages } from "./messages.js";

export const en: YuanbaoMessages = {
  fallbackReply: "Sorry, I couldn't answer that. Please try rephrasing your question.",

  accountsNeedUsable:
    "channel.options.accounts must contain at least one enabled account with appKey/appSecret, or a token (static token also requires botId)",

  missingAppKey: "Yuanbao appKey is required",

  missingAppSecret: "Yuanbao appSecret is required",

  staticTokenNeedsBotId: "A static Yuanbao token also requires botId",

  scheduledFailureWithId: (taskId, message) =>
    `⏰ Scheduled task #${taskId} failed: ${message}`,

  scheduledFailure: (message) =>
    `⏰ Scheduled task failed: ${message}`,

  taskCompleted: "Task completed.",

  executionError: (message) => `⚠️ Execution error: ${message}`,

  bgDone: (display) => `✅ ${display} completed — /use ${display} to view result`,

  bgError: (display) => `⚠️ ${display} failed — /use ${display} to view details`,
};
