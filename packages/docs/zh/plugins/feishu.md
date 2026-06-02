# 飞书频道

## 概述

`@ganglion/xacpx-channel-feishu` 是 xacpx 的官方飞书频道插件。它连接飞书自建应用，将消息路由至 xacpx 的命令与会话系统。根据聊天类型，回复可渲染为流式交互式卡片、静态文本消息，或两者混合。

## 安装

```bash
xacpx plugin add @ganglion/xacpx-channel-feishu
xacpx channel add feishu
xacpx restart
```

该频道需要飞书自建应用的 `appId` 和 `appSecret`。

## 必填应用凭据

使用应用 ID 和密钥配置频道：

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

或通过 `xacpx channel add feishu --app-id cli_xxx --app-secret yyy` 传入。

## 回复渲染模式

频道通过 `options.replyMode` 控制三种回复模式：

| 模式 | 行为 |
|------|-------|
| `"auto"`（默认） | 私聊（p2p）使用流式渲染；群聊使用静态渲染。群聊消息本身已按线程顺序呈现，静态多消息路径在此场景下更简洁。 |
| `"streaming"` | 每轮对话创建一张 CardKit v2 交互式卡片并原地更新：思考中 → 流式输出 → 已完成（或已中止/报错）。输出在单个消息槽中逐步呈现。 |
| `"static"` | 每个 `reply()` 片段以及最终 agent 回复均以独立文本消息发送，每条均回复用户原始消息。 |

全局设置：

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

或按账号设置：

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

## 流式卡片

流式输出期间，卡片智能使用两个 CardKit 端点：

- `cardElement.content` 用于纯文本增量——payload 更小，原生打字机动画。
- 状态转换、图片 key 到达、推理面板切换以及最终状态时，使用完整的 `card.update`。

最终状态卡片在页脚显示本轮耗时（如 `已完成 · 3.4s`）。实时流式卡片也显示滚动计时页脚（`⏳ 处理中... 8.2s`），为长任务提供持续的时间信号。

输出 `<think>...</think>` / `<thinking>...</thinking>` 块（或 `Reasoning:\n_…_` 前缀）的模型，其推理内容会渲染在答案上方的独立注释块中，答案正文前有水平分割线。

Markdown 图片 URL（`![alt](https://...)`）会即时解析为飞书 `image_key` 引用，使卡片内联渲染图片。在可配置超时内无法解析的 URL 会被去除。

流式卡片在守护进程关闭时优雅终止：SIGINT/SIGTERM/`beforeExit` 会将所有进行中的卡片驱动至 `已停止` 状态后再退出进程。xacpx 守护进程被强制终止后，不会再在用户飞书聊天中留下停滞在 `处理中...` 的卡片。

### 所需机器人权限

流式模式需要机器人具有 **`cardkit:card:write`** 和 **`im:message:send_as_bot`** 权限。若初始 `cardkit.v1.card.create` 调用失败（最常见原因：缺少权限），频道会记录 `feishu.streaming.fallback` 并对本轮回退至静态模式。若失败为飞书权限错误（代码 `99991672`），还会以每 5 分钟一次的冷却频率向用户发送授权 URL。

## 工具调用渲染

当 xacpx 会话回复模式（配置路径 `channel.replyMode`，可选值 `stream` / `final` / `verbose`）为 `verbose` 时，若同时使用流式模式，工具调用会渲染为答案正文上方可折叠的 **🔧 工具调用 (N)** 面板，而非内联文本片段。每一步显示：

- 状态：✅ / ⏳ / ❌
- 类型图标：📖 读取 · 🔍 搜索 · 💻 执行 · ✏️ 编辑 · 🧠 思考 · 🔧 其他
- 工具名称
- 从调用输入派生的单行摘要（如文件路径、命令、搜索模式）
- 完成后显示耗时

流式卡片通过注册 `onToolEvent` 回调消费结构化工具使用侧信道。只要提供了处理函数，transport 默认将 `toolEventMode` 设为 `"structured"`，事件便流入可折叠卡片面板而非旧式文本气泡。

静态模式保留旧式内联行为——每次工具调用作为独立文本消息发送。

## 取消操作

当 agent 正在处理时，用户可发送以下任意内容取消：`stop`、`/stop`、`abort`、`停止`、`取消` 等。频道将：

1. 中止本轮的 `AbortController`，路由将其转发给 `transport.cancel()`，从而中断底层 `acpx` 进程。
2. 在流式卡片上渲染 `已停止` 最终状态，或在静态模式下发送 `已停止当前任务。` 回复。
3. 移除添加到用户原始消息上的"正在输入"反应表情。

`/cancel <alias>` 和 `/stop <alias>` 通过别名精准定向某个会话的进行中请求——使用与 `/use` 相同的模糊别名解析。

## 后台执行语义

每条入站 prompt 在**分发时**绑定到当前聊天所在的会话，并在**按会话划分的车道**上运行：

- **不同会话并发运行。** 在任务进行中切换到其他会话（`/use` / `/ss`）可立即使用新会话——不同会话的请求互不阻塞。
- **同一会话的请求串行化**，保证会话内的顺序。
- **切换和取消命令优先执行。** `/use`、`/ss`、`/cancel`、`/stop` 在**控制车道**上运行，即使 prompt 正在执行也立即生效。进行中的 prompt 继续在后台运行。

切换离开某个正在运行的会话后，其请求继续执行。飞书使用**"B 语义"**（基于卡片）：

- 后台会话有**独立的流式卡片**，在聊天时间线中**持续刷新直至完成**——不受任何门控或压制。结果保留在该卡片上。
- 完成时，向聊天发送一条简短提示：`✅ <alias> 已完成` 或 `⚠️ <alias> 失败`。与微信频道不同，这里**没有 `/use <alias> 查看结果` 后缀**——卡片上已保留结果，无需回放。
- 切换**回**该会话**不会**重新发送结果。
- `/sessions` 会用 `●` 标记存在未完成或未读后台完成记录的会话。

## 权限与回退行为

频道会自动提示缺失的权限：当飞书 API 返回权限错误时，机器人从授权 URL 中提取缺失权限，并以每 5 分钟一次的频率向用户发送该 URL，从而在运行时精准报告应用所需的权限。

频道回复路径明确需要以下两个权限：

| 权限 | 用于 |
| --- | --- |
| `im:message:send_as_bot` | 发送回复（所有回复模式） |
| `cardkit:card:write` | 创建和更新流式卡片 |

除此之外，机器人还需要飞书标准消息接收权限（通常为私信和群聊消息读取权限）。在飞书开发者控制台配置这些权限；频道的运行时授权提示会指出任何缺失的权限。

若缺少 `cardkit:card:write`，频道会自动对本轮回退至静态模式并记录 `feishu.streaming.fallback`。首次失败后 5 分钟窗口内会向用户发送授权 URL。

## 配置示例

最简配置（静态模式）：

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

流式模式并要求 @提及：

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

`requireMention: true` 表示机器人仅处理在群聊中明确 @提及机器人的消息。私聊消息无论此设置如何均会被处理。
