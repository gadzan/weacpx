import type { AcpxNoteMessages } from "../../types";

export const acpxNote: AcpxNoteMessages = {
  // translateAcpxNote — built-in agent spawn
  spawnBuiltIn: (name) => `🔩 正在启动内置 agent \`${name}\``,

  // translateAcpxNote — generic agent spawn
  spawnAgent: "🔩 正在启动 agent 进程",

  // translateAcpxNote — downloading deps
  downloading: "📥 正在下载 agent 依赖…",

  // translateAcpxNote — installing/extracting deps
  installing: "🧩 正在安装 agent 依赖…",

  // translateAcpxNote — initializing
  initializing: "🔧 agent 初始化中…",

  // translateAcpxNote — fallback raw line
  fallback: (line) => `ℹ️ ${line}`,
};
