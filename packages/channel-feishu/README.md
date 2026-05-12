# @ganglion/weacpx-channel-feishu

Feishu channel plugin for `weacpx`.

```bash
weacpx plugin add @ganglion/weacpx-channel-feishu
weacpx channel add feishu
weacpx restart
```

The channel requires a Feishu self-built app `appId` and `appSecret`.

## Reply rendering: `replyMode`

| Mode | Behaviour |
|------|-----------|
| `"static"` (default) | Every `reply()` chunk + the final agent response are sent as separate text messages, replying to the user's incoming message. |
| `"streaming"` | The channel creates one CardKit v2 interactive card per turn and updates it in place — thinking → streaming → complete (or aborted/error). User sees output appear progressively in one message slot. |
| `"auto"` | Streaming for direct (p2p) chats, static for groups. Groups already serialize visually around a thread, so the multi-message static path stays simpler there. |

While streaming, the card uses two CardKit endpoints intelligently:
- `cardElement.content` for pure-text deltas — smaller payload, native typewriter animation.
- Full `card.update` on state transitions, image-key arrival, reasoning panel toggles, and the final state.

Final-state cards include the elapsed turn time in the footer (e.g. `已完成 · 3.4s`). Models that emit `<think>...</think>` / `<thinking>...</thinking>` (or a `Reasoning:\n_…_` prefix) get the reasoning rendered above the answer in a separate notation-sized block, with a horizontal divider before the answer body. Markdown image URLs (`![alt](https://...)`) are resolved to Feishu `image_key` references on the fly so the card renders the image inline; URLs that don't resolve within the configurable timeout are stripped.

Streaming mode requires the bot to have **`cardkit:card:write`** plus **`im:message:send_as_bot`** scopes. If the initial `cardkit.v1.card.create` call fails (most commonly: missing scope), the channel logs `feishu.streaming.fallback` and falls back to the static path for that turn. When the failure is a Feishu permission error (code `99991672`) the grant URL is also sent to the user once per 5-minute cooldown.

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

## Cancelling the in-flight turn

While the agent is processing, the user can send `stop`, `/stop`, `abort`, `停止`, `取消`, etc. The channel:

1. Aborts the per-turn `AbortController` (which the router forwards to `transport.cancel()` so the underlying `acpx` process is interrupted).
2. Renders an "已停止" final state on the streaming card, or sends a "已停止当前任务。" reply in static mode.
3. Removes the typing reaction added to the user's original message.

