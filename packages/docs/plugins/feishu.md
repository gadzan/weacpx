# Feishu Channel

## Overview

`@ganglion/xacpx-channel-feishu` is the official Feishu channel plugin for xacpx. It connects to a Feishu self-built app and routes messages through xacpx's command and session system. Replies can be rendered as streaming interactive cards, static text messages, or a mix of both depending on chat type.

## Install

```bash
xacpx plugin add @ganglion/xacpx-channel-feishu
xacpx channel add feishu
xacpx restart
```

The channel requires a Feishu self-built app `appId` and `appSecret`.

## Required app credentials

Configure the channel with your Feishu app ID and secret:

```jsonc
{
  "channels": [
    {
      "id": "feishu",
      "type": "feishu",
      "options": {
        "appId": "cli_xxx",
        "appSecret": "yyy"
      }
    }
  ]
}
```

Or supply them via `xacpx channel add feishu --app-id cli_xxx --app-secret yyy`.

## Reply rendering modes

The channel supports three reply modes controlled by `options.replyMode`:

| Mode | Behavior |
|------|-----------|
| `"auto"` (default) | Streaming for direct (p2p) chats; static for groups. Groups already serialize visually in a thread, so the multi-message static path stays simpler there. |
| `"streaming"` | The channel creates one CardKit v2 interactive card per turn and updates it in place: thinking → streaming → complete (or aborted/error). Output appears progressively in a single message slot. |
| `"static"` | Every `reply()` chunk plus the final agent response are sent as separate text messages, each replying to the user's incoming message. |

Set globally:

```jsonc
{
  "channels": [
    {
      "id": "feishu",
      "type": "feishu",
      "options": {
        "appId": "cli_xxx",
        "appSecret": "yyy",
        "replyMode": "streaming"
      }
    }
  ]
}
```

Or per account:

```jsonc
{
  "options": {
    "replyMode": "streaming",
    "accounts": {
      "main":   { "appId": "...", "appSecret": "...", "replyMode": "streaming" },
      "legacy": { "appId": "...", "appSecret": "...", "replyMode": "static" }
    }
  }
}
```

## Streaming cards

While streaming, the card uses two CardKit endpoints intelligently:

- `cardElement.content` for pure-text deltas — smaller payload, native typewriter animation.
- Full `card.update` on state transitions, image-key arrival, reasoning panel toggles, and the final state.

Final-state cards display the elapsed turn time in the footer (e.g. `已完成 · 3.4s`). Live streaming cards also show a ticking elapsed footer (`⏳ 处理中... 8.2s`) so long-running tasks provide a continuous time signal.

Models that emit `<think>...</think>` / `<thinking>...</thinking>` blocks (or a `Reasoning:\n_…_` prefix) have the reasoning rendered above the answer in a separate notation-sized block, with a horizontal divider before the answer body.

Markdown image URLs (`![alt](https://...)`) are resolved to Feishu `image_key` references on the fly so the card renders images inline. URLs that do not resolve within the configurable timeout are stripped.

The streaming card terminates gracefully on daemon shutdown: SIGINT/SIGTERM/`beforeExit` drives every in-flight card to its "已停止" state before the process exits. A killed xacpx daemon no longer leaves cards stuck at "处理中..." in the user's Feishu chat.

### Required bot scopes

Streaming mode requires the bot to have **`cardkit:card:write`** plus **`im:message:send_as_bot`** scopes. If the initial `cardkit.v1.card.create` call fails (most commonly: missing scope), the channel logs `feishu.streaming.fallback` and falls back to the static path for that turn. When the failure is a Feishu permission error (code `99991672`), the grant URL is also sent to the user once per 5-minute cooldown.

## Tool call rendering

When `channel.replyMode: "verbose"` (the default) is paired with streaming mode, tool calls are rendered as a collapsible **🔧 工具调用 (N)** panel above the answer body instead of inline text segments. Each step shows:

- Status: ✅ / ⏳ / ❌
- Kind icon: 📖 read · 🔍 search · 💻 execute · ✏️ edit · 🧠 think · 🔧 other
- Tool name
- A one-line summary derived from the call's input (e.g. file path, command, search pattern)
- Duration once finished

The streaming card consumes the structured tool-use side-channel by registering an `onToolEvent` callback. The transport defaults to `toolEventMode: "structured"` whenever a handler is provided, so events flow into the collapsible card panel instead of the legacy text bubbles.

Static mode keeps the legacy inline behavior — each tool call appears as its own text message.

## Cancellation

While the agent is processing, the user can send any of: `stop`, `/stop`, `abort`, `停止`, `取消`, etc. The channel:

1. Aborts the per-turn `AbortController`, which the router forwards to `transport.cancel()` so the underlying `acpx` process is interrupted.
2. Renders an "已停止" final state on the streaming card, or sends a "已停止当前任务。" reply in static mode.
3. Removes the typing reaction added to the user's original message.

`/cancel <alias>` and `/stop <alias>` target a specific session's in-flight turn by alias — fuzzy alias resolution applies, the same as `/use`.

## Background execution semantics

Each inbound prompt is **bound at dispatch time** to whatever session the chat is currently on, then runs on a **per-session lane**:

- **Different sessions run concurrently.** Switching to another session (`/use` / `/ss`) while a task is in flight lets you use the new session immediately — turns on different sessions do not block each other.
- **Same-session turns serialize**, preserving order within a session.
- **Switch and cancel commands preempt.** `/use`, `/ss`, `/cancel`, `/stop` run on a **control lane** and take effect immediately even while a prompt is running. The running prompt continues in the background.

When you switch away from a running session, its turn keeps executing. Feishu uses **"B-semantics"** (card-based):

- The backgrounded session has its **own streaming card** that keeps refreshing **to completion in the chat timeline** — it is not gated or suppressed. The result stays on that card.
- On completion, a short ping is sent to the chat: `✅ <alias> 已完成` (or `⚠️ <alias> 失败`). Unlike the WeChat channel, there is **no `/use 查看结果` suffix** — there is nothing to replay because the card already holds the result.
- Switching **back** to that session does **not** re-send the result.
- `/sessions` marks sessions with an unfinished or unread background completion using `●`.

## Permissions and fallback behavior

The channel surfaces missing-scope errors automatically: when the Feishu API returns a permission error, the bot extracts the missing scope from the grant URL and sends that URL to the user (once per 5-minute cooldown), so the exact scope your app needs is reported at runtime.

Two scopes are explicitly required by the channel's reply paths:

| Scope | Required for |
| --- | --- |
| `im:message:send_as_bot` | Sending replies (all reply modes) |
| `cardkit:card:write` | Streaming card creation and updates |

Beyond these, the bot also needs the standard Feishu message-receiving scopes for the chat types you use (typically the direct-message and group-message read scopes). Configure these in the Feishu developer console; the channel's runtime grant prompt will name any that are missing.

If `cardkit:card:write` is missing, the channel automatically falls back to static mode for that turn and logs `feishu.streaming.fallback`. A grant URL is sent to the user on the first failure within each 5-minute window.

## Configuration examples

Minimal configuration (static mode):

```jsonc
{
  "plugins": [
    { "name": "@ganglion/xacpx-channel-feishu", "version": "latest", "enabled": true }
  ],
  "channels": [
    {
      "id": "feishu",
      "type": "feishu",
      "enabled": true,
      "options": {
        "appId": "cli_xxx",
        "appSecret": "yyy"
      }
    }
  ]
}
```

Streaming mode with mention requirement:

```jsonc
{
  "channels": [
    {
      "id": "feishu",
      "type": "feishu",
      "enabled": true,
      "options": {
        "appId": "cli_xxx",
        "appSecret": "yyy",
        "replyMode": "streaming",
        "requireMention": true
      }
    }
  ]
}
```

`requireMention: true` means the bot only processes group messages that explicitly @-mention the bot. Direct messages are always processed regardless of this setting.
