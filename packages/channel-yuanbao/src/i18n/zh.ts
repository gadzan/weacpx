import type { YuanbaoMessages } from "./messages.js";

export const zh: YuanbaoMessages = {
  fallbackReply: "暂时无法解答，你可以换个问题问问我哦",

  accountsNeedUsable:
    "channel.options.accounts 中至少要有一个启用账号同时配置 appKey/appSecret，或者配置 token（静态 token 还需要 botId）",

  missingAppKey: "缺少 Yuanbao appKey",

  missingAppSecret: "缺少 Yuanbao appSecret",

  staticTokenNeedsBotId: "静态 Yuanbao token 需要同时配置 botId",

  scheduledFailureWithId: (taskId, message) =>
    `⏰ 定时任务 #${taskId} 执行失败：${message}`,

  scheduledFailure: (message) =>
    `⏰ 定时任务执行失败：${message}`,

  taskCompleted: "任务已完成。",

  executionError: (message) => `⚠️ 执行出错：${message}`,

  bgDone: (display) => `✅ ${display} 已完成，/use ${display} 查看结果`,

  bgError: (display) => `⚠️ ${display} 失败，/use ${display} 查看详情`,
};
