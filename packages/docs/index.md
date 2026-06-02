---
layout: home

hero:
  name: xacpx
  text: Remote agent control from chat
  tagline: Control acpx sessions from WeChat, Feishu, Yuanbao, and other message channels.
  actions:
    - theme: brand
      text: Get Started
      link: /guide/getting-started
    - theme: alt
      text: Command Reference
      link: /reference/commands

features:
  - title: Chat-native control
    details: Start sessions, switch context, send prompts, and cancel work from supported chat channels.
  - title: acpx transport bridge
    details: Use the direct acpx CLI transport or the JSON bridge subprocess transport.
  - title: Extensible channels
    details: Add first-party or external channel plugins without changing the core console.
---

## What is xacpx?

xacpx is a chat-channel console for remotely controlling `acpx` agent sessions. It acts as a bridge between your chat application and the agent CLI running on your machine, letting you start, switch, and cancel agent work without leaving your phone.

You can use xacpx to drive Codex, Claude Code, Gemini, OpenCode, and any other agent that `acpx` supports — all from a familiar messaging interface.

## When to use it

xacpx is the right tool when you want lightweight, on-the-go access to long-running agent sessions. Common scenarios include:

- Monitoring or redirecting an agent while you are away from your desk.
- Managing several parallel sessions across different projects from a single chat thread.
- Delegating sub-tasks to other agents without opening a terminal.

If your workflow is entirely local and terminal-based, you do not need xacpx — it adds value specifically through the chat channel layer.

## Core workflow

The typical sequence is four steps:

1. **Start the background daemon** — `xacpx start`
2. **Create or switch a session** — `/ss codex -d /path/to/project` or `/use <alias>`
3. **Send plain text prompts** — any message that does not start with `/` is forwarded to the current session
4. **Check status or cancel** — `/status`, `/cancel`

**Session model.** xacpx maintains two distinct layers of session state. A *logical session* is xacpx-managed: it holds an alias, the chosen agent, a workspace binding, and the per-user chat context. A *transport session* is the actual named `acpx` session running on the backend. `/session new` (or the shorthand `/ss`) creates both at once. `/session attach` creates only the logical session and binds it to a transport session that already exists — useful when you have an `acpx` session running independently and want to hook xacpx's chat layer on top of it without disturbing the existing conversation.

## Supported channels

xacpx ships with WeChat as the built-in default channel. Additional channels are distributed as official plugin packages:

| Channel | Package |
|---------|---------|
| WeChat (built-in) | — |
| Feishu | `@ganglion/xacpx-channel-feishu` |
| Yuanbao | `@ganglion/xacpx-channel-yuanbao` |

Third-party channels follow the same plugin interface. Install a channel plugin with `xacpx plugin add <package>`, configure it with `xacpx channel add <name>`, then restart the daemon.

## Next steps

- [Getting Started](/guide/getting-started) — install xacpx, log in, and run your first session
- [Command Reference](/reference/commands) — full listing of chat commands (`/ss`, `/use`, `/cancel`, and more)
- [Configuration](/reference/configuration) — config file fields, transport options, and workspace/agent registration
- [Plugin Development](/plugins/development) — build your own channel plugin
