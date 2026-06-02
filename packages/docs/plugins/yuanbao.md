# Yuanbao Channel

## Overview

`@ganglion/xacpx-channel-yuanbao` is the official Tencent Yuanbao channel plugin for xacpx. It connects over a long-lived WebSocket, uses custom signing, and routes messages through xacpx's command and session system. Replies are sent as linear text messages.

## Install

```bash
xacpx plugin add @ganglion/xacpx-channel-yuanbao
xacpx channel add yuanbao
xacpx restart
```

## Required options

Supply these credentials in `channels[].options` or via `xacpx channel add yuanbao`:

- `appKey`
- `appSecret`

Example configuration:

```jsonc
{
  "plugins": [
    { "name": "@ganglion/xacpx-channel-yuanbao", "version": "latest", "enabled": true }
  ],
  "channels": [
    {
      "id": "yuanbao",
      "type": "yuanbao",
      "enabled": true,
      "options": {
        "appKey": "your-app-key",
        "appSecret": "your-app-secret"
      }
    }
  ]
}
```

## Compatibility with existing configs

Existing configs that already have `channels[].type = "yuanbao"` remain valid after installing this plugin — no migration needed.

## Real-time session switching

Each inbound prompt is **bound at dispatch time** to whatever session the chat is currently on, then runs on a **per-session lane**:

- **Different sessions run concurrently.** Switching to another session (`/use` / `/ss`) while a task is in flight lets you use the new session immediately — turns on different sessions do not block each other.
- **Same-session turns serialize**, preserving order within a session.
- **Switch and cancel commands preempt.** `/use`, `/ss`, `/cancel`, `/stop` run on a **control lane** and take effect immediately even while a prompt is running. The running prompt continues in the background.

## Background execution semantics

When you switch away from a running session, its turn keeps executing in the background. Yuanbao is a linear-text channel, so it follows the **WeChat "A-semantics"** (not Feishu's card-based B-semantics):

- A backgrounded turn's **mid-stream output is suppressed** — it is not sent into the chat that now shows a different session.
- On completion, its **final answer is stored** and a short ping is sent to the active chat: `✅ <alias> 已完成，/use <alias> 查看结果` (or `⚠️ <alias> 失败，/use <alias> 查看详情`).
- Switching **back** to that session (`/use <alias>`) **replays** the stored result.
- `/sessions` marks sessions with an unfinished or unread background completion using `●`.
