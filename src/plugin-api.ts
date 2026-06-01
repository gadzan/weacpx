export type { ChannelPluginDefinition } from "./channels/plugin.js";
export type { ChannelFactory, CreateChannelDeps } from "./channels/create-channel.js";
export type {
  ChannelStartInput,
  ConsumerLock,
  ConsumerLockMetadata,
  ConsumerLockOptions,
  CoordinatorMessageInput,
  MessageChannelRuntime,
  ScheduledChannelMessageInput,
  OrchestrationDeliveryCallbacks,
  OutboundQuota,
  ToolUseEvent,
  ToolUseKind,
  ToolUseStatus,
} from "./channels/types.js";
export type {
  ChannelCliInput,
  ChannelCliIo,
  ChannelCliParseResult,
  ChannelCliProvider,
  ChannelCliValidationIssue,
} from "./channels/cli/provider.js";
export type { ChannelRuntimeConfig } from "./config/types.js";
export type { CommandHint } from "./commands/command-hints.js";
export type { AppLogger } from "./logging/app-logger.js";
export type { WeacpxPlugin, XacpxPlugin } from "./plugins/types.js";
export {
  WEACPX_PLUGIN_API_VERSION,
  WEACPX_PLUGIN_API_SUPPORTED_VERSIONS,
  WEACPX_PLUGIN_MIN_CORE_VERSION,
} from "./plugins/types.js";

// Realtime session switching + per-session concurrency primitives, shared with
// channel plugins (feishu, yuanbao, …) that re-implement their own dispatch/
// output layer but reuse core lane scheduling + session state.
export { createConversationExecutor } from "./runtime/conversation-executor.js";
export type { ConversationExecutor, ConversationExecutorLane } from "./runtime/conversation-executor.js";
export { resolveTurnLane } from "./runtime/turn-lane.js";
export { createActiveTurnRegistry } from "./sessions/active-turn-registry.js";
export type { ActiveTurnRegistry } from "./sessions/active-turn-registry.js";
export { toDisplaySessionAlias } from "./channels/channel-scope.js";
export type { SessionService } from "./sessions/session-service.js";
export type { BackgroundResult } from "./state/types.js";
export type { ChatRequestMetadata } from "./weixin/agent/interface.js";
