import type { RouterMessages } from "../../types";

export const router: RouterMessages = {
  // ensureTransportSession — auto-install progress
  depMissing: (pkg) => `📦 检测到缺失依赖 \`${pkg}\`，正在自动安装…`,
  depInstallVerifying: "🔄 安装完成，正在验证会话启动…",

  // createProgressHandler — heartbeat / spawn / initializing
  agentHeartbeat: (agent, elapsed) => `⏳ \`${agent}\` 仍在准备中…（已等待 ${elapsed}s）`,
  agentSpawning: (agent) => `🚀 正在启动 \`${agent}\`…`,
  agentInitializing: (agent, elapsed) => `🔧 \`${agent}\` 初始化中…（已等待 ${elapsed}s）`,

  // createProgressHandler — acpx note with elapsed
  acpxNoteElapsed: (note, elapsed) => `${note}（已等待 ${elapsed}s）`,
};
