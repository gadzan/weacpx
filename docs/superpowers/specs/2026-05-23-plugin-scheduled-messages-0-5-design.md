# Plugin Scheduled Messages 0.5 Design

## Goal

Enable `/lt` scheduled tasks in the Feishu and Yuanbao channel plugins, while releasing the required core API surface as `weacpx@0.5.0`.

## Version and Compatibility Policy

Core `weacpx` will be bumped to `0.5.0`.

The first-party channel plugin package versions remain independent and do not get forced to `0.5.0`:

- `@ganglion/weacpx-channel-feishu` remains on its current plugin package version unless a separate release process changes it.
- `@ganglion/weacpx-channel-yuanbao` remains on its current plugin package version unless a separate release process changes it.

Both first-party plugins will declare that their new scheduled-message-capable versions require core `0.5.0`:

- plugin metadata: `minWeacpxVersion: "0.5.0"`
- package peer dependency: `weacpx: ">=0.5.0-0"`

The public plugin API will export `ScheduledChannelMessageInput` so plugins can implement `MessageChannelRuntime.sendScheduledMessage` without depending on private core paths. Core will also include `taskId` in scheduled delivery input so channels can render consistent failure notices without parsing the human-facing `noticeText`.

## Architecture

Core already owns `/lt` command parsing, task persistence, scheduler timing, and capability gating. Channel plugins own scheduled delivery because only each channel knows how to route outbound messages back to the original chat and how to execute an agent turn with the right channel metadata.

The runtime flow remains:

1. `/lt` creates a task only when the current channel supports `sendScheduledMessage`.
2. The scheduler claims due tasks.
3. Core calls `channelRegistry.sendScheduledMessage(input)`.
4. The registry routes by `chatKey` to the original channel runtime.
5. The channel sends a trigger notice, runs a non-interactive agent turn, and delivers any streamed/final output to the original chat.

The existing execution-time registry guard remains as defense for old tasks, disabled plugins, or config changes after task creation.

## Token and Route Context Semantics

`replyContextToken` in scheduled delivery is a task-creation snapshot. For Feishu and Yuanbao it comes from the inbound message id that created the `/lt` task. Core does not refresh it at execution time because it is channel-specific reply/thread context, not an authentication token.

If the snapshot is missing or no longer usable, the channel should still deliver to the parsed chat route as a fresh message. Feishu already has a guarded reply path that marks unavailable message ids and falls back to a fresh send. Yuanbao scheduled delivery should retry once without `replyContextToken` if the gateway rejects a quoted/replied send.

Feishu tenant access tokens are separate from `replyContextToken` and are owned by the Feishu client/runtime. Scheduled delivery does not persist or reuse tenant access tokens from task creation.

## Abort Semantics

The scheduler creates an `AbortController` for each scheduled dispatch and aborts it when the per-dispatch timeout elapses. This prevents a wedged non-interactive scheduled turn from holding the scheduler tick lock forever.

User `/cancel` messages are not wired to a scheduled turn in this release. Runtime shutdown may stop channel runtimes, but the explicit scheduled `abortSignal` should be treated as the authoritative per-turn cancellation signal. Yuanbao may also consult the channel-level abort signal to avoid sending during shutdown, but it must pass `input.abortSignal` to `agent.chat` when present.

## Feishu Design

`packages/channel-feishu/src/channel.ts` will implement:

```ts
async sendScheduledMessage(input: ScheduledChannelMessageInput): Promise<void>
```

Initial behavior is intentionally plain-text, not streaming-card based:

1. Validate `FeishuChannel.start()` initialized `agent` and `logger`.
2. Parse `input.chatKey` with existing `parseFeishuConversationId`.
3. Resolve the target account runtime from the parsed account id.
4. Send `input.noticeText` using existing `sendRouteText(input.chatKey, input.replyContextToken, input.noticeText)`.
5. Call `this.agent.chat` with:
   - `accountId`: parsed account id
   - `conversationId`: `input.chatKey`
   - `text`: `input.promptText`
   - `replyContextToken`: `input.replyContextToken` when present
   - `abortSignal`: `input.abortSignal` when present
   - `metadata`: `{ channel: "feishu", scheduledSessionAlias: input.sessionAlias }`
   - `reply`: sends non-empty intermediate text with `sendRouteText`
6. Deliver non-empty `response.text` with `sendRouteText`.
7. If the agent returns outbound media, log `feishu.scheduled.media_unsupported` at error level with the media count and continue text delivery. Images and files are nice-to-have follow-ups; first release support is text-only for scheduled Feishu output.

The first implementation will not create or update streaming cards for scheduled tasks. That keeps scheduled dispatch independent from inbound `ActiveTask` tracking, abort command ownership, card lifecycle, and typing indicators.

## Yuanbao Design

`packages/channel-yuanbao/src/channel.ts` will implement:

```ts
async sendScheduledMessage(input: ScheduledChannelMessageInput): Promise<void>
```

The implementation reuses Yuanbao's existing route parsing and outbound queueing:

1. Validate `YuanbaoChannel.start()` initialized `agent`, `gateway`, and `logger`.
2. Parse `input.chatKey` with existing `parseYuanbaoChatKey`.
3. Resolve the target account with `accountById`.
4. Send `input.noticeText` through existing `sendRouteText`.
5. Create a turn queue with existing `createTurnQueue`, using the parsed route and `input.replyContextToken`.
6. Call `this.agent.chat` with:
   - `accountId`: parsed account id
   - `conversationId`: `input.chatKey`
   - `text`: `input.promptText`
   - `replyContextToken`: `input.replyContextToken` when present
   - `abortSignal`: `input.abortSignal` when present, or the channel abort signal only as a shutdown fallback
   - `metadata`: `{ channel: "yuanbao", scheduledSessionAlias: input.sessionAlias }`
   - `reply`: pushes intermediate text to the queue
7. Push non-empty `response.text` to the queue and flush.
8. Preserve existing chunking, merge, overflow, and reply quote behavior through `createTurnQueue`.
9. Log unsupported outbound media like normal Yuanbao turns do today.

Scheduled Yuanbao turns do not send reply heartbeats in the first implementation because they are not tied to a fresh inbound Yuanbao user message with sender context. `createTurnQueue` does not depend on heartbeat state; it only schedules outbound text buffering/flush behavior.

## Error Handling

If the trigger notice cannot be sent because route/account delivery fails, the scheduled dispatch fails and core marks the task failed.

If the notice succeeds but the agent turn throws, each plugin should best-effort send a short failure text back to the same route, then rethrow so the scheduler records failure. Use a consistent format: `⏰ 定时任务 #<taskId> 执行失败：<error message>` when `taskId` is present, otherwise `⏰ 定时任务执行失败：<error message>`.

If the scheduler aborts a scheduled turn through `input.abortSignal`, plugins should pass the signal into `agent.chat` and stop sending queued content once aborted.

Scheduled turns in Feishu and Yuanbao do not use the Weixin quota window. They must not call `quota.onInbound()` for scheduled dispatch. If a user sends a new inbound message while a scheduled turn is running, that inbound turn follows the channel's existing normal-message path; it must not reset or consume a separate scheduled quota state.

## Tests

Add or update tests for:

- Feishu channel implements `sendScheduledMessage` and sends notice plus final response.
- Feishu scheduled turn passes `scheduledSessionAlias` metadata, `taskId`, scheduler `abortSignal`, and uses the creation-time `replyContextToken` snapshot when available.
- Feishu scheduled turn logs unsupported response media without failing text delivery.
- Yuanbao channel implements `sendScheduledMessage` and sends notice plus final response through the gateway.
- Yuanbao scheduled turn uses the outbound queue/chunking path and passes `scheduledSessionAlias` metadata, `taskId`, and scheduler `abortSignal`.
- Yuanbao scheduled turn retries without `replyContextToken` if quote/reply delivery fails.
- Scheduled plugin turns do not call `quota.onInbound()` and remain independent from normal inbound quota reset behavior.
- First-party plugin metadata declares `minWeacpxVersion: "0.5.0"`.
- First-party plugin `peerDependencies.weacpx` is `">=0.5.0-0"`.
- `weacpx/plugin-api` exports `ScheduledChannelMessageInput`.
- Core/package version files are synchronized to `0.5.0`: root `package.json`, root `package-lock.json` top-level/package entries, and any source constants that define the minimum first-party plugin core version. Plugin package versions themselves remain unchanged.

## Non-Goals

- Do not implement Feishu streaming-card scheduled turns in this release.
- Do not implement scheduled Feishu/Yuanbao outbound media delivery in this release; log unsupported media and keep text reliable.
- Do not add a `skipOutboundMedia` flag to `ScheduledChannelMessageInput`; outbound media support is a channel behavior concern and adding a core flag would expand the API without a current caller that needs to vary it.
- Do not implement Yuanbao reply heartbeats for scheduled turns in this release.
- Do not change core scheduled persistence or scheduler timing semantics.
- Do not force first-party plugin package versions to match the core `0.5.0` version.
