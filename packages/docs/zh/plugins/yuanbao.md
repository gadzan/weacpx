# 元宝频道

## 概述

`@ganglion/xacpx-channel-yuanbao` 是 xacpx 的官方腾讯元宝频道插件。它通过长连接 WebSocket 接入，使用自定义签名，将消息路由至 xacpx 的命令与会话系统。回复以线性文本消息发送。

## 安装

```bash
xacpx plugin add @ganglion/xacpx-channel-yuanbao
xacpx channel add yuanbao
xacpx restart
```

## 必填选项

在 `channels[].options` 中提供以下凭据，或通过 `xacpx channel add yuanbao` 传入：

- `appKey`
- `appSecret`

配置示例：

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

## 与现有配置的兼容性

已有 `channels[].type = "yuanbao"` 的配置在安装此插件后仍然有效，无需迁移。

## 实时会话切换

每条入站 prompt 在**分发时**绑定到当前聊天所在的会话，并在**按会话划分的车道**上运行：

- **不同会话并发运行。** 在任务进行中切换到其他会话（`/use` / `/ss`）可立即使用新会话——不同会话的请求互不阻塞。
- **同一会话的请求串行化**，保证会话内的顺序。
- **切换和取消命令优先执行。** `/use`、`/ss`、`/cancel`、`/stop` 在**控制车道**上运行，即使 prompt 正在执行也立即生效。进行中的 prompt 继续在后台运行。

## 后台执行语义

切换离开某个正在运行的会话后，其请求继续在后台执行。元宝是线性文本频道，遵循**微信"A 语义"**（而非飞书基于卡片的 B 语义）：

- 后台请求的**流式输出被压制**——不会发送到当前显示其他会话的聊天中。
- 完成时，其**最终答案被存储**，并向活跃聊天发送一条简短提示：`✅ <alias> 已完成，/use <alias> 查看结果`（或 `⚠️ <alias> 失败，/use <alias> 查看详情`）。
- 切换**回**该会话（`/use <alias>`）会**回放**已存储的结果。
- `/sessions` 会用 `●` 标记存在未完成或未读后台完成记录的会话。
