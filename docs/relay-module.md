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

## 测试

- 单测按文件跑（tests/unit/packages/relay、tests/unit/packages/channel-relay）；
  run-tests.mjs 会预构建 relay-protocol dist。
- 端到端手工验证 runbook：
  1. `bun run build:packages`
  2. `node packages/relay/dist/cli.js init-admin --username admin --db /tmp/relay.db`
  3. `node packages/relay/dist/cli.js start --db /tmp/relay.db`
  4. `node packages/relay/dist/cli.js token new --account admin --db /tmp/relay.db`
  5. 另一终端：dry-run 或真实 xacpx 安装 channel-relay、channel add、restart，
     然后 curl 登录 + `POST /api/instances/<id>/rpc {"type":"control.sessions.list"}` 验证。
