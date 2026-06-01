import type { ConversationExecutorLane } from "./conversation-executor.js";

// Channel-agnostic lane classifier. Switch/cancel commands must PREEMPT an
// in-flight prompt so the user can change the foreground session in real time;
// they only touch chat-context state and never run a long task, so the control
// lane is safe. Everything else — including `/ssn` (native session discovery,
// which can be slow) and normal prompts — runs on the per-session normal lane.
//
// NOTE: weixin keeps its own `getWeixinMessageTurnLane` (it consumes a
// WeixinMessage and additionally routes the weixin-only `/jx` no-op). This
// text-based helper is the version non-weixin channels use.
const CONTROL_COMMANDS = new Set(["/use", "/ss", "/cancel", "/stop"]);

export function resolveTurnLane(text: string): ConversationExecutorLane {
  const command = text.trim().toLowerCase().split(/\s+/)[0] ?? "";
  return CONTROL_COMMANDS.has(command) ? "control" : "normal";
}
