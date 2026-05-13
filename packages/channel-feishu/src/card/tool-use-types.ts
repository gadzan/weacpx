// Channel-internal render shape produced by collapsing multiple
// ToolUseEvent updates sharing the same toolCallId. See tool-use-store.
import type { ToolUseEvent, ToolUseKind, ToolUseStatus } from "weacpx/plugin-api";

export type { ToolUseEvent, ToolUseKind, ToolUseStatus };

export interface ToolUseStep {
  toolCallId: string;
  toolName: string;
  kind: ToolUseKind;
  summary?: string;
  status: ToolUseStatus;
  startedAt: number;
  durationMs?: number;
}
