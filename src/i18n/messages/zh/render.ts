import type { RenderMessages } from "../../types";

export const render: RenderMessages = {
  // render-text: renderTaskProgress
  taskProgress: (taskId, targetAgent, summary) =>
    `⏳ 任务「${taskId}」（${targetAgent}）：${summary}`,

  // render-text: renderTaskHeartbeat
  taskHeartbeat: (taskId, minutes) =>
    `⏳ 任务「${taskId}」已运行 ${minutes} 分钟，等待中...`,
};
