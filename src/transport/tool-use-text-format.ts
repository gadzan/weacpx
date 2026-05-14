import type { ToolUseEvent } from "../channels/types.js";

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

const KIND_EMOJI: Record<string, string> = {
  read: "\u{1F4D6}",
  search: "\u{1F50D}",
  execute: "\u{1F4BB}",
  edit: "\u{270F}\u{FE0F}",
  think: "\u{1F9E0}",
};

const DEFAULT_EMOJI = "\u{1F527}";

function truncateToolDisplay(text: string): string {
  return text.length > 60 ? `${text.slice(0, 57)}...` : text;
}

/**
 * Renders a {@link ToolUseEvent} into the legacy emoji-prefixed text segment
 * shape used by Phase 0 channels. Returns null when the event should be
 * suppressed (already-emitted toolCallId or empty toolName).
 *
 * This is a best-effort port of the parser-side text-mode rendering
 * (`formatToolCallEvent` in `streaming-prompt.ts`). Two intentional
 * divergences from the legacy parser formatter:
 *
 * 1. **Status strings**: The legacy formatter uses raw acpx status strings
 *    (`"pending"`, `"completed"`, `"failed"`) because it operates on the raw
 *    update. `ToolUseEvent.status` is already normalized to
 *    `"running" | "success" | "error"`, so this formatter always produces
 *    those normalized strings in the status suffix.
 *
 * 2. **Status always present**: The legacy formatter omits the status suffix
 *    when `update.status` is falsy. `ToolUseEvent` always carries a status,
 *    so this formatter always includes the `(status)` suffix.
 *
 * 3. **Placeholder skipping**: The legacy formatter skips "pending"
 *    placeholders without input because it can inspect `update.status ===
 *    "pending"` directly. That raw field is not preserved on `ToolUseEvent`,
 *    so this helper cannot reproduce that heuristic. Callers that need to
 *    suppress placeholder events should do so before calling this function.
 *
 * This helper is intended for downstream channel adapters (Phase 4) that
 * consume the structured side-channel but want a legacy-compatible text
 * fallback.
 */
export function formatToolUseEventForText(
  event: ToolUseEvent,
  state: ToolUseTextRenderState,
): string | null {
  const toolName = event.toolName.trim();
  if (toolName.length === 0) return null;

  if (state.emittedToolCallIds.has(event.toolCallId)) return null;
  state.emittedToolCallIds.add(event.toolCallId);

  const emoji = KIND_EMOJI[event.kind] ?? DEFAULT_EMOJI;
  const statusText = ` (${event.status})`;
  const summaryText =
    event.summary && event.summary !== toolName
      ? `: ${truncateToolDisplay(event.summary)}`
      : "";

  return `${emoji} ${toolName}${statusText}${summaryText}`;
}
