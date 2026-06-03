import type { RenderMessages } from "../../types";

export const render: RenderMessages = {
  // render-text: renderTaskProgress
  taskProgress: (taskId, targetAgent, summary) =>
    `⏳ Task "${taskId}" (${targetAgent}): ${summary}`,

  // render-text: renderTaskHeartbeat
  taskHeartbeat: (taskId, minutes) =>
    `⏳ Task "${taskId}" has been running for ${minutes} minute(s), waiting...`,
};
