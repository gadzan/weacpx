import type { NonInteractivePermissions, PermissionMode } from "../config/types";
import type { QuotaManager } from "../weixin/messaging/quota-manager.js";
import type { ToolUseEvent } from "../channels/types.js";
import type { ToolEventMode } from "./tool-event-mode.js";

export type { ToolEventMode } from "./tool-event-mode.js";

export interface ReplyQuotaContext {
  chatKey: string;
  quota: QuotaManager;
}

export interface PromptMedia {
  type: "image" | "audio" | "video" | "file";
  filePath: string;
  mimeType: string;
  fileName?: string;
}

export interface PermissionPolicy {
  permissionMode: PermissionMode;
  nonInteractivePermissions: NonInteractivePermissions;
  permissionPolicy?: string;
}

export interface ResolvedSession {
  alias: string;
  agent: string;
  agentCommand?: string;
  workspace: string;
  transportSession: string;
  mcpCoordinatorSession?: string;
  mcpSourceHandle?: string;
  modeId?: string;
  replyMode?: "stream" | "final" | "verbose";
  cwd: string;
}

export type EnsureSessionProgressStage = "spawn" | "initializing" | "ready";
export type EnsureSessionProgress =
  | EnsureSessionProgressStage
  | { kind: "note"; text: string };

export type PromptMediaInput = PromptMedia | PromptMedia[];

export interface PromptOptions {
  onSegment?: (text: string) => void | Promise<void>;
  /**
   * Structured side-channel for tool calls. See `toolEventMode` for routing.
   *
   * Async semantics: callbacks are invoked in event order and serialized —
   * each invocation is awaited before the next is dispatched. The transport
   * waits for all callbacks to settle before resolving the prompt. If any
   * invocation throws or returns a rejected promise, the prompt rejects
   * with the first observed error (matching `onSegment` behavior).
   */
  onToolEvent?: (event: ToolUseEvent) => void | Promise<void>;
  /**
   * Optional structured side-channel for the agent's thinking/reasoning.
   *
   * Each acpx `agent_thought_chunk` is forwarded raw (no buffering, no
   * paragraph splitting). Channels that register this callback opt in to
   * receiving thoughts and are responsible for their own accumulation /
   * rendering. When omitted, thought chunks are dropped at the transport
   * boundary — the built-in WeChat channel does not register it.
   *
   * Async semantics match `onSegment`: invocations are serialized and the
   * transport awaits all of them before resolving the prompt; the first
   * error observed rejects the prompt.
   */
  onThought?: (chunk: string) => void | Promise<void>;
  /**
   * How tool_call / tool_call_update events are surfaced for this prompt.
   *
   * - "text" (default when no handler): legacy emoji-prefixed segments in the reply stream.
   * - "structured" (default when a handler is provided): events go to `onToolEvent` only.
   * - "both": events go to `onToolEvent` AND legacy text segments — useful for migration.
   *
   * Resolved at the transport boundary via `resolveToolEventMode`.
   */
  toolEventMode?: ToolEventMode;
  media?: PromptMediaInput;
}

export interface SessionTransport {
  ensureSession(
    session: ResolvedSession,
    onProgress?: (progress: EnsureSessionProgress) => void,
  ): Promise<void>;
  tailSessionHistory(session: ResolvedSession, lines: number): Promise<{ text: string }>;
  prompt(
    session: ResolvedSession,
    text: string,
    reply?: (text: string) => Promise<void>,
    replyContext?: ReplyQuotaContext,
    options?: PromptOptions,
  ): Promise<{ text: string }>;
  setMode(session: ResolvedSession, modeId: string): Promise<void>;
  cancel(session: ResolvedSession): Promise<{ cancelled: boolean; message: string }>;
  hasSession(session: ResolvedSession): Promise<boolean>;
  removeSession?(session: ResolvedSession): Promise<void>;
  updatePermissionPolicy?(policy: PermissionPolicy): Promise<void>;
  dispose?(): Promise<void>;
}
