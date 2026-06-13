# Relay Hub 模块说明（packages/relay + packages/channel-relay）

自托管多实例遥控枢纽。设计 spec：docs/superpowers/specs/2026-06-13-relay-hub-design.md。

## 服务端（@ganglion/xacpx-relay）

- 运行时：Node >= 22.13（node:sqlite）或 Bun >= 1.2（bun:sqlite），SqlDriver 适配层自动选择。
- 两个端口：HTTP API（默认 8787，登录/邀请/实例/RPC 代理）+ 实例 WS 网关（默认 8788）。
- 快速开始：
  1. `xacpx-relay init-admin --username admin --db ./relay.db`
  2. `xacpx-relay start --db ./relay.db`
  3. `xacpx-relay token new --account admin --name home-pc --db ./relay.db`
- 安全：scrypt 密码哈希（node:crypto 内置，格式含参数可迁移）；所有 token/凭证哈希落盘；登录限流；RPC 代理只放行
  control.* 且服务端覆写 chatKey(`relay:<accountId>`)/senderId/isOwner。

## 连接器（@ganglion/xacpx-channel-relay）

- 安装与配对：
  ```
  xacpx plugin add @ganglion/xacpx-channel-relay
  xacpx channel add relay --url ws://<relay-host>:8788 --token <pairing-token>
  xacpx restart
  ```
- 首连用配对 token 注册并换发长期凭证，存 `<xacpx-home>/relay/credential.json`
  （weixin 凭证先例；config.json 只存 url/pairingToken）。token 单次有效，
  过期/已用需在 relay 侧重新生成并 `xacpx channel add relay` 更新。
- 桥接面：relay 的 control.* RPC → 核心 ControlService（见 docs/control-module.md）；
  ControlEventBus 事件与编排通知上行为 instance.event / instance.notice。
- 阶段边界：离线不排队（实例离线时 RPC 返回 503）；事件断线期间丢弃；
  Web 看板（阶段三）消费本阶段的 HTTP API 与事件。

## 阶段三服务端接缝（Web 看板扇出）

服务端为 Web 看板新增的接缝（见 docs/relay-web-module.md）：

- **`messages` 缓存表（§5）+ `MessageStore`**：聊天回显缓存
  （`instance_id, session_alias, direction, text, created_at`）。`append()` 写入，
  `listBySession(accountId, ...)` 按 account 隔离、oldest-first 取最近若干条。
- **`WebGateway` 按账号扇出**：跟踪每个账号已鉴权的浏览器 socket，把 `WebServerEvent`
  编码为 `web.event` 信封 `broadcast(accountId, event)` 给该账号所有连接。
- **实例网关 `onStatusChange`/`onEvent` 接线**（server.ts `createRelayRuntime`）：
  - `onStatusChange` → web 广播 `instance-status`；离线时清空该实例的 turn 缓冲。
  - `onEvent`（instance.event）→ web 广播 `control-event`；其中 `turn-output` 分片按
    (instance, session) 累积进内存缓冲，`turn-finished` 时 flush 为一条 `out` 历史消息
    写入 `MessageStore`；instance.notice → 广播 `notice`。
- **cookie 鉴权的 `/ws` web 扇出端点**：挂在 HTTP server 的 upgrade 上（与实例网关 `wsPort`
  分离），校验 `xrelay_session` cookie → 账号后 `webGateway.register(accountId, ws)`。
- **`GET /api/instances/:id/sessions/:alias/messages`**：按登录账号返回该会话的缓存历史。
- **prompt 回显历史**：`control.prompt` 经 RPC 代理时，把 prompt 文本 append 为一条 `in` 历史消息。
- **command 回显历史（阶段四）**：`control.command.execute` 经 RPC 代理时，把输入文本 append 为 `in`、
  把返回 `output` append 为 `out`（与 `control.prompt` 的 `in` 回显并列），使 `/命令` 结果也能跨 reload 存活。
- **`--web-root` 静态托管**：`createRelayRuntime({ webRoot })` → Hono `serveStatic` 托管 SPA
  构建产物（含 index.html SPA fallback）；CLI `xacpx-relay start --web-root <dir>`。

## 阶段四服务端接缝（维护循环与配置）

- **`GET /api/config`（authed）**：返回 `{ historyRetention: { days, maxPerSession } }` 供设置页展示；
  历史保留是服务端配置（只读），v1 不在 Web 端可改。
- **维护子系统 `src/maintenance.ts`**：`runMaintenance(stores, opts)` 跑一遍清理，
  `startMaintenanceLoop(...)` 每小时一次（`setInterval` 并 `unref`，不挡进程退出）：
  - 按账龄裁剪 `messages`（`--history-retention-days`，默认 30 天）+ 每会话硬上限
    `MAX_MESSAGES_PER_SESSION = 2000`（保最新）——`MessageStore.prune({ maxAgeMs?, maxPerSession? })`；
  - GC 过期/已用的 `web_sessions`、`invites`（`AccountStore.pruneExpired(now)`）与
    `pairing_tokens`（`InstanceStore.prunePairingTokens(now)`）。
- **CLI**：`xacpx-relay start --history-retention-days <n>`（透传给维护循环）。

## 测试

- 单测按文件跑（tests/unit/packages/relay、tests/unit/packages/channel-relay）；
  run-tests.mjs 会预构建 relay-protocol dist。
- 全链路：`tests/unit/packages/relay/web-dashboard-e2e.test.ts` 用真实 relay-server
  （`startRelayServer`）+ 真实连接器（RelayClient/createControlBridge/subscribeControlEvents）
  验证 实例事件 → relay → web 客户端 + 历史缓存的端到端路径。
- 端到端手工验证 runbook：
  1. `bun run build:packages`
  2. `node packages/relay/dist/cli.js init-admin --username admin --db /tmp/relay.db`
  3. `node packages/relay/dist/cli.js start --db /tmp/relay.db`
  4. `node packages/relay/dist/cli.js token new --account admin --db /tmp/relay.db`
  5. 另一终端：dry-run 或真实 xacpx 安装 channel-relay、channel add、restart，
     然后 curl 登录 + `POST /api/instances/<id>/rpc {"type":"control.sessions.list"}` 验证。
