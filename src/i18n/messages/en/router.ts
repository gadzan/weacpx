import type { RouterMessages } from "../../types";

export const router: RouterMessages = {
  // ensureTransportSession — auto-install progress
  depMissing: (pkg) => `📦 Missing dependency \`${pkg}\` detected, installing automatically…`,
  depInstallVerifying: "🔄 Installation complete, verifying session startup…",

  // createProgressHandler — heartbeat / spawn / initializing
  agentHeartbeat: (agent, elapsed) => `⏳ \`${agent}\` is still starting up… (waited ${elapsed}s)`,
  agentSpawning: (agent) => `🚀 Starting \`${agent}\`…`,
  agentInitializing: (agent, elapsed) => `🔧 \`${agent}\` initializing… (waited ${elapsed}s)`,

  // createProgressHandler — acpx note with elapsed
  acpxNoteElapsed: (note, elapsed) => `${note} (waited ${elapsed}s)`,
};
