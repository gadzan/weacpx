import type { ToolUseEvent } from "../channels/types.js";
import { TOOL_KIND_EMOJI, DEFAULT_TOOL_EMOJI } from "./tool-kind-emoji.js";

/**
 * Tracks which toolCallIds have already been rendered, so duplicate events
 * (e.g. running → success for the same tool call) are deduplicated.
 */
export interface ToolUseTextRenderState {
  emittedToolCallIds: Set<string>;
}

export function createToolUseTextRenderState(): ToolUseTextRenderState {
  return { emittedToolCallIds: new Set() };
}

function truncateToolDisplay(text: string): string {
  return text.length > 60 ? `${text.slice(0, 57)}...` : text;
}

/**
 * Best-effort adapter that renders a {@link ToolUseEvent} as a single
 * emoji-prefixed text segment, for downstream channels that consume the
 * structured side-channel but want a text fallback.
 *
 * NOT a drop-in replacement for the parser's text-mode path. The parser
 * keeps its own raw-update formatter (`formatToolCallEvent` in
 * `streaming-prompt.ts`) because some heuristics need raw acpx fields
 * (e.g. `update.status === "pending"`) that are lost on `ToolUseEvent`.
 *
 * Documented divergences from the legacy parser output:
 *
 * 1. Status text is normalized (`"running"` / `"success"` / `"error"`) rather
 *    than the raw acpx values (`"pending"` / `"completed"` / `"failed"`).
 * 2. Status is always present in the suffix; the legacy formatter omitted
 *    status when the raw value was empty.
 * 3. Generic-pending placeholders are NOT skipped. The placeholder-skip
 *    heuristic in the parser needs `update.status === "pending"` which is
 *    not preserved on `ToolUseEvent`. Callers that want this behavior
 *    must filter before invoking the helper.
 *
 * Dedup: returns `null` for any `toolCallId` already in `state.emittedToolCallIds`.
 * Returns `null` for events with an empty/whitespace `toolName`.
 */
export function formatToolUseEventForText(
  event: ToolUseEvent,
  state: ToolUseTextRenderState,
): string | null {
  const toolName = event.toolName.trim();
  if (toolName.length === 0) return null;

  if (state.emittedToolCallIds.has(event.toolCallId)) return null;
  state.emittedToolCallIds.add(event.toolCallId);

  const emoji = TOOL_KIND_EMOJI[event.kind] ?? DEFAULT_TOOL_EMOJI;
  const statusText = ` (${event.status})`;
  const summaryText =
    event.summary && event.summary !== toolName
      ? `: ${truncateToolDisplay(event.summary)}`
      : "";

  return `${emoji} ${toolName}${statusText}${summaryText}`;
}
