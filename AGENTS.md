This file provides guidance to Agent when working with code in this repository.

## Build & Test Commands

```bash
bun run build          # Build CLI to ./dist (outputs cli.js and bridge/bridge-main.js)
npx tsc --noEmit       # Run TypeScript typecheck
npm test               # Run typecheck, then all unit tests (tests/unit/**/*.test.ts)
npm run test:unit      # Alias for above
npm run test:smoke     # Run smoke tests (tests/smoke/**/*.test.ts)
```

`transport.permissionMode` defaults to `approve-all` when omitted, so non-interactive prompt turns do not stop on acpx permission requests unless the user explicitly configures a stricter policy.

**Local daemon CLI (before publish):**
```bash
bun run dev            # Run console in foreground (dev mode)
bun run login          # Show QR code for WeChat login
node ./dist/cli.js start   # Start daemon in background
node ./dist/cli.js status  # Check daemon status
node ./dist/cli.js stop    # Stop daemon
```

**Local dry-run (no WeChat needed):**
```bash
bun run dry-run --chat-key wx:test -- "/session new demo --agent codex --ws backend" "/status"
```

## Architecture Overview

### Core Purpose
xacpx is a WeChat console that lets you remotely control `acpx` sessions. It bridges WeChat messages to agent sessions via `weixin-agent-sdk`.

### Key Modules

- **`src/cli.ts`** - Daemon CLI (`start`/`status`/`stop`/`run`/`login`). Not the main app entry.
- **`src/main.ts`** - `buildApp()` assembles the runtime; `resolveRuntimePaths()` finds config/state files.
- **`src/run-console.ts`** - Orchestrates app build, SDK start, heartbeat, and cleanup.
- **`src/console-agent.ts`** - Bridges WeChat messages to the command router.
- **`src/commands/command-router.ts`** - Routes WeChat commands (`/agent add`, `/session new`, etc.) to handlers.
- **`src/commands/parse-command.ts`** - Parses slash commands into typed structures.

### Transport Layer (src/transport/)

Two transport implementations share the `SessionTransport` interface:

- **`acpx-cli`** - Spawns `acpx` directly as a child process. Uses `node-pty` for PTY allocation.
- **`acpx-bridge`** - Runs `acpx` in a separate bridge subprocess (`src/bridge/bridge-main.ts`). Uses stdin/stdout JSON protocol.

Both transports expose: `ensureSession`, `prompt`, `setMode`, `cancel`, `hasSession`.

### Session Model

There are two session concepts:

1. **Logical session** (managed by `SessionService`) - tracks alias, agent, workspace, and chat context per user.
2. **Transport session** - the actual `acpx` named session on the backend.

`/session new` creates both. `/session attach` only creates the logical session and binds to an existing transport session.

### Config & State

- Config (`~/.xacpx/config.json`) - transport, agents, workspaces. Written via `ConfigStore`.
- State (`~/.xacpx/state.json`) - sessions, chat contexts. Written via `StateStore`.

### Daemon Subsystem

- **src/daemon/daemon-controller.ts** — External daemon control surface (start/status/stop).
- **src/daemon/create-daemon-controller.ts** — Wires platform-specific spawn/terminate behavior into the controller.
- **src/daemon/daemon-runtime.ts** — Writes PID/status metadata and heartbeat from inside the daemon process.
- **src/daemon/daemon-status.ts** — Reads and writes status.json for daemon readiness/state inspection.
- **src/daemon/daemon-files.ts** — Resolves daemon runtime paths (pid, status, logs).

### Bridge Subsystem

- **`src/bridge/bridge-main.ts`** - Entry point for the bridge subprocess (handles acpx stdio).
- **`src/bridge/bridge-server.ts`** - Parses bridge protocol JSON lines and delegates to `BridgeRuntime`.
- **`src/bridge/bridge-runtime.ts`** - Wraps raw acpx commands (sessions new, prompt, cancel).

### Acpx Resolution (priority order)

1. `transport.command` in config (explicit override)
2. Bundled `acpx` in `node_modules`
3. `acpx` in shell `PATH`

### Test Layout

- `tests/unit/` - Mirror of `src/` structure, `*.test.ts` files. Run by default.
- `tests/smoke/` - Real-environment tests (real acpx, real WeChat). Not run by default.
- `tests/helpers/` - Shared test utilities.

## Onboarding Notes (where to look first)

### Mental model

- Treat xacpx as a bridge: **Channel runtime (built-in Weixin or plugin channel such as Feishu/Yuanbao) → Router (slash commands + prompt) → Session mapping → Transport (acpx)**.
- There are two sessions: **logical session** (xacpx-managed) vs **transport session** (acpx-managed). Most bugs are mismatches between the two.

### Start reading from entrypoints

- CLI surface: [`src/cli.ts`](src/cli.ts)
- Wiring/DI and runtime paths: [`src/main.ts`](src/main.ts)
- Main loop (startup/shutdown ordering): [`src/run-console.ts`](src/run-console.ts)
- Router and command boundaries: [`src/commands/command-router.ts`](src/commands/command-router.ts) + [`src/commands/parse-command.ts`](src/commands/parse-command.ts)
- Session state model: [`src/sessions/session-service.ts`](src/sessions/session-service.ts)
- Transport boundary: [`src/transport/types.ts`](src/transport/types.ts)

### When changing behavior, follow the boundaries

- Core channel work stays inside [`src/channels/`](src/channels/) and is limited to Weixin plus generic channel/plugin infrastructure. New non-Weixin channels must be implemented as plugin packages under [`packages/channel-*`](packages/) or as external npm plugins.
- Command semantics live in [`src/commands/`](src/commands/) (parse + handlers + router).
- Anything that touches `acpx` must go through transport implementations in [`src/transport/`](src/transport/).
- Daemon lifecycle lives in [`src/daemon/`](src/daemon/) and should remain compatible with `xacpx start/status/stop`.

### Docs to rely on (don’t reverse-engineer from code first)

- Configuration schema and defaults: [`docs/config-reference.md`](docs/config-reference.md)
- WeChat command surface: [`docs/commands.md`](docs/commands.md)
- Daemon subsystem notes: [`docs/daemon-module.md`](docs/daemon-module.md)
- Commands module notes: [`docs/commands-module.md`](docs/commands-module.md)
- MCP integration (external coordinators): [`docs/external-mcp.md`](docs/external-mcp.md)
- `xacpx doctor` diagnostics and `--fix` repairs: [`docs/doctor-command.md`](docs/doctor-command.md)
- Control API（结构化控制面，relay 等结构化消费者入口）: [`docs/control-module.md`](docs/control-module.md)
- Relay Hub 自托管部署/运维（operator 向）: [`docs/relay-deployment.md`](docs/relay-deployment.md)（完整图文在文档站 `guide/relay-self-hosting`）
- Relay Hub（服务端 + 连接器）: [`docs/relay-module.md`](docs/relay-module.md)
- Relay Web 看板模块说明: [`docs/relay-web-module.md`](docs/relay-web-module.md)
- Code Wiki (architecture map): [`docs/code-wiki.md`](docs/code-wiki.md)

## Package Manager

Uses **Bun** for development scripts and builds. Dependencies are in `package.json`. The lockfile is `bun.lock`.

## References

- [weixin-agent-sdk](https://github.com/wong2/weixin-agent-sdk)
- [acpx](https://github.com/openclaw/acpx)
- 测试文档请参考 [docs/testing.md](docs/testing.md)
- 配置文件详解 [docs/config-reference.md](docs/config-reference.md)
- `/config` 命令说明 [docs/config-command.md](docs/config-command.md)
- `/later` 定时任务命令说明 [docs/later-command.md](docs/later-command.md)
- `xacpx doctor` 命令说明 [docs/doctor-command.md](docs/doctor-command.md)
- `src/commands` 模块说明 [commands-module.md](docs/commands-module.md)
- `src/daemon` 模块说明 [daemon-module.md](docs/daemon-module.md)
- 计划文档 [superpower/plans](docs/superpowers/plans/)
- 项目介绍 [README.md](README.md)

# 其它
xacpx 运行日志：` ~/.xacpx/runtime/app.log`;
acpx 源码：`../acpx`;

## 维护 AGENTS.md

- 目标：让第一次接触仓库的人能在 10 分钟内建立正确心智模型，并能快速定位到“该改哪里/该看哪份文档/该跑什么命令”。
- 内容原则：
  - 只写长期稳定的约束与导航；易变的实现细节放到 `docs/` 或 Code Wiki。
  - 优先给“入口文件/模块目录/文档链接”，而不是给具体函数行号或内部流程细节。
  - 链接一律使用仓库相对路径，避免机器相关的绝对路径。
- 更新流程：
  - 当新增/重构一个子系统时：先补齐对应 `docs/*.md`（或更新现有文档），再在本文件里追加一条导航入口。
  - 当新增 CLI/配置/命令面能力时：优先更新 `README.md` / `docs/commands.md` / `docs/config-reference.md`，然后在本文件“Docs to rely on”里补链接。
  - 保持本文件短；超过一屏的细节应迁移到 `docs/` 或 `docs/code-wiki.md`。
- `CLAUDE.md` 是 `AGENTS.md` 的符号链接；只编辑 `AGENTS.md`，不要直接改 `CLAUDE.md`。
