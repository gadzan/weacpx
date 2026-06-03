import type { AcpxNoteMessages } from "../../types";

export const acpxNote: AcpxNoteMessages = {
  // translateAcpxNote — built-in agent spawn
  spawnBuiltIn: (name) => `🔩 Starting built-in agent \`${name}\``,

  // translateAcpxNote — generic agent spawn
  spawnAgent: "🔩 Starting agent process",

  // translateAcpxNote — downloading deps
  downloading: "📥 Downloading agent dependencies…",

  // translateAcpxNote — installing/extracting deps
  installing: "🧩 Installing agent dependencies…",

  // translateAcpxNote — initializing
  initializing: "🔧 Agent initializing…",

  // translateAcpxNote — fallback raw line
  fallback: (line) => `ℹ️ [acpx] ${line}`,
};
