import type { Agent as ChatAgent } from "../weixin/agent/interface.js";
import type { OrchestrationTaskRecord } from "../orchestration/orchestration-types.js";
import type { AppLogger } from "../logging/app-logger.js";
import type { PendingFinalChunk } from "../weixin/messaging/quota-manager.js";

export type { ChatAgent };

export interface OutboundQuota {
  onInbound(chatKey: string): void;
  reserveMidSegment(chatKey: string): boolean;
  reserveFinal(chatKey: string): boolean;
  finalRemaining(chatKey: string): number;
  hasPendingFinal(chatKey: string): boolean;
  drainPendingFinalUpToBudget(chatKey: string, available: number): PendingFinalChunk[];
  prependPendingFinal(chatKey: string, chunks: PendingFinalChunk[]): void;
  enqueuePendingFinal(chatKey: string, chunks: PendingFinalChunk[]): void;
  clearPendingFinal(chatKey: string): void;
}

export interface CoordinatorMessageInput {
  coordinatorSession: string;
  chatKey: string;
  accountId?: string;
  replyContextToken?: string;
  text: string;
}

export interface ChannelStartInput {
  agent: ChatAgent;
  abortSignal: AbortSignal;
  quota: OutboundQuota;
  logger: AppLogger;
}

export interface OrchestrationDeliveryCallbacks {
  markTaskNoticeDelivered: (taskId: string, accountId: string) => Promise<void>;
  markTaskNoticeFailed: (taskId: string, errorMessage: string) => Promise<void>;
}

export interface ConsumerLockMetadata {
  pid: number;
  mode: "foreground" | "daemon";
  startedAt: string;
  configPath: string;
  statePath: string;
  hostname?: string;
}

export interface ConsumerLock {
  acquire(meta: ConsumerLockMetadata): Promise<void>;
  release(): Promise<void>;
}

export interface ConsumerLockOptions {
  lockFilePath?: string;
  onDiagnostic?: (
    event: string,
    context: Record<string, string | number | boolean | undefined>,
  ) => void | Promise<void>;
}

export interface MessageChannelRuntime {
  id: string;

  isLoggedIn(): boolean;
  login(): Promise<string>;
  logout(): void;

  start(input: ChannelStartInput): Promise<void>;

  createConsumerLock?(options?: ConsumerLockOptions): ConsumerLock;

  configureOrchestration?(callbacks: OrchestrationDeliveryCallbacks): void;

  notifyTaskCompletion(task: OrchestrationTaskRecord): Promise<void>;
  notifyTaskProgress(task: OrchestrationTaskRecord, text: string): Promise<void>;
  sendCoordinatorMessage(input: CoordinatorMessageInput): Promise<void>;
}

// Structured tool-use event. The transport emits one of these per acpx
// `tool_call` / `tool_call_update` session update when the consuming side
// has registered an `onToolEvent` handler. Channels collapse multiple
// events sharing the same toolCallId into a single render step.

export type ToolUseStatus = "running" | "success" | "error";
// Matches the kinds emitted by acpx via streaming-prompt.ts KIND_EMOJI.
// Any kind the transport doesn't recognize maps to "other".
export type ToolUseKind = "read" | "search" | "execute" | "edit" | "think" | "other";

export interface ToolUseEvent {
  toolCallId: string;
  /** Free-form tool name from the agent (e.g. "Read File", "Bash"). */
  toolName: string;
  /** Coarse classifier produced by the transport from the agent's tool kind; channels use it to pick an icon. */
  kind: ToolUseKind;
  /** Best-effort one-line summary derived from `rawInput`. */
  summary?: string;
  status: ToolUseStatus;
  /** Set when status transitions out of "running". */
  durationMs?: number;
}
