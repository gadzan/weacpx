import type { ToolUseEvent } from "../channels/types.js";

export type ToolEventMode = "text" | "structured" | "both";

/**
 * Resolves the effective tool-event rendering mode.
 *
 * Resolution order (hard contract — preserves Phase 0 invariant):
 *   1. Explicit `toolEventMode` always wins.
 *   2. `onToolEvent` present → "structured" (structured consumer, suppress text tool calls).
 *   3. Default → "text" (legacy text tool calls; no structured consumer).
 */
export function resolveToolEventMode(input?: {
  toolEventMode?: ToolEventMode;
  onToolEvent?: (event: ToolUseEvent) => void | Promise<void>;
}): ToolEventMode {
  if (input?.toolEventMode !== undefined) {
    return input.toolEventMode;
  }
  if (input?.onToolEvent !== undefined) {
    return "structured";
  }
  return "text";
}
