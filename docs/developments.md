# 开发指南

本文档面向希望在 `weacpx` 上进行本地开发、调试和贡献代码的开发者。

如果你只是想安装和使用工具，请先看 [README.md](../README.md)。

## 项目简介

`weacpx` 是一个把微信消息桥接到 `acpx` 会话的控制台。它允许用户在微信里远程管理 agent、workspace、session，并把普通文本消息转发给当前会话。

核心目标是：

- 在微信里完成常见的 agent、workspace、session 管理
- 用尽量少的配置接入已有的 `acpx` 工作流
- 为本地运行和远程操作提供统一的命令入口

## 开发环境准备

开始前请确认本机具备：

- Node.js
- Bun
- 一个可用的微信登录环境
- 本机可以运行 `acpx` 及其目标 agent

## 安装依赖

首次拉代码后执行：

```bash
bun install
```

## 构建与测试

构建 CLI 到 `dist`：

```bash
bun run build
```

运行默认单元测试：

```bash
npm test
```

显式运行 unit tests：

```bash
npm run test:unit
```

运行 smoke tests：

```bash
npm run test:smoke
```

更多测试说明见 [docs/testing.md](./testing.md)。

## 本地运行与调试

前台开发模式：

```bash
bun run dev
```

登录微信二维码：

```bash
bun run login
```

本地 daemon CLI 烟测：

```bash
node ./dist/cli.js start
node ./dist/cli.js status
node ./dist/cli.js stop
```

本地 dry-run：

```bash
bun run dry-run --chat-key wx:test -- "/session new demo --agent codex --ws backend" "/status"
```

发布后的 CLI 入口命令：

```bash
weacpx login
weacpx start
weacpx status
weacpx stop
```

## 项目结构

关键文件和模块：

- `src/cli.ts`：Daemon CLI，包含 `start`、`status`、`stop`、`run`、`login`
- `src/main.ts`：`buildApp()` 组装运行时；`resolveRuntimePaths()` 解析配置和状态路径
- `src/run-console.ts`：启动 SDK、心跳、清理逻辑
- `src/console-agent.ts`：把微信消息桥接到命令路由
- `src/commands/command-router.ts`：处理 `/agent add`、`/session new` 等命令
- `src/commands/parse-command.ts`：解析 slash commands

测试目录：

- `tests/unit/`：镜像 `src/` 结构的单元测试
- `tests/smoke/`：真实环境 smoke tests
- `tests/helpers/`：测试辅助工具

## 架构说明

### Core Purpose

`weacpx` 是一个让用户通过微信远程控制 `acpx` session 的控制台，底层通过 `weixin-agent-sdk` 把微信消息桥接到 agent 会话。

### Transport Layer

`src/transport/` 下有两个实现，它们共享 `SessionTransport` 接口：

- `acpx-cli`：直接以子进程方式拉起 `acpx`，使用 `node-pty` 分配 PTY
- `acpx-bridge`：在单独的 bridge 子进程中运行 `acpx`，通过 stdin/stdout JSON 协议通信

两个 transport 都暴露：

- `ensureSession`
- `prompt`
- `cancel`
- `hasSession`
- `listSessions`

### Session Model

项目中有两种 session 概念：

1. `logical session`
2. `transport session`

`logical session` 由 `SessionService` 管理，负责 alias、agent、workspace 和 chat context。

`transport session` 是 backend 上实际存在的 `acpx` named session。

命令行为：

- `/session new` 会同时创建两者
- `/session attach` 只创建 logical session，并绑定到已有 transport session

### Daemon Subsystem

- `src/daemon/daemon-runtime.ts`：daemon 生命周期管理，包括 PID 和 heartbeat
- `src/daemon/daemon-files.ts`：解析 PID、日志等运行文件路径
- `src/daemon/create-daemon-controller.ts`：CLI controller 工厂

### Bridge Subsystem

- `src/bridge/bridge-main.ts`：bridge 子进程入口
- `src/bridge/bridge-server.ts`：解析 bridge JSON 行协议并转发到 `BridgeRuntime`
- `src/bridge/bridge-runtime.ts`：封装原始 `acpx` 命令，如 session 创建、prompt、cancel

## 配置与状态文件

默认路径：

- 配置：`~/.weacpx/config.json`
- 状态：`~/.weacpx/state.json`

完整配置字段参考：[docs/config-reference.md](./config-reference.md)

### acpx 解析顺序

运行时会按以下顺序选择 `acpx`：

1. `transport.command`
2. 项目内安装的 `acpx`
3. Shell `PATH` 中的 `acpx`

### weixin-agent-sdk 解析顺序

运行时会按以下顺序加载微信 SDK：

1. `WEACPX_WEIXIN_SDK`
2. 已安装包 `weixin-agent-sdk`

### `dry-run`

`dry-run` 会复用同一套 router、session service、transport，只是把微信消息换成终端输入，适合本地排查。

示例：

```bash
bun run dry-run --chat-key wx:test -- \
  "/agent add codex" \
  "/ws new backend -d /absolute/path/to/backend" \
  "/ss new demo -a codex --ws backend" \
  "/status"
```


## 相关文档

- 用户文档：[README.md](../README.md)
- 配置参考：[docs/config-reference.md](./config-reference.md)
- 测试说明：[docs/testing.md](./testing.md)
## Session & Command Notes

- 命令边界与 session 流向说明：`docs/2026-03-30-command-boundaries-and-session-flow.md`
- `/session ls --agent --ws` 设计说明：`docs/2026-03-30-session-list-design.md`
- `acpx` session 与 `weacpx` session 映射说明：`docs/2026-03-30-acpx-session-mapping.md`

## 会话创建用户体验

`transport.ensureSession(session, onProgress?)` 会汇报 `spawn` / `initializing` / `ready` 三个里程碑。`command-router` 把它们翻译为防抖的微信消息（`initializing` 需距 `spawn` 消息 ≥3s 才发）。

当桥返回 `MissingOptionalDepError` 时，`command-router` 调用 `src/recovery/auto-install-optional-dep.ts`（精确安装在 parent 包目录，失败回落到全局安装）。成功时 `ensureSession` 重试**一次**；失败时抛出 `AutoInstallFailedError`，由 `renderSessionCreationError` 渲染为包含原错误、两次 stderr 摘要、`npm install -g <pkg>` 手动命令和日志路径的用户消息。

相关文件：
- 规范：`docs/superpowers/specs/2026-04-22-session-creation-ux-design.md`
- 计划：`docs/superpowers/plans/2026-04-22-session-creation-ux.md`
