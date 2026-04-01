# Changelog

## [0.1.7] - 2026-04-01

### Added

- 新增 `docs/commands-module.md`（命令路由模块架构说明）与 `docs/daemon-module.md`（守护进程子系统概述），补充 `docs/testing.md` 参考路径说明。
- 新增 `src/commands/router-types.ts`（统一上下文与 Ops 接口类型）与 `src/commands/transport-diagnostics.ts`（transport 错误摘要复用工具）。

### Refactored

- `command-router.ts` 拆分为 8 个独立 handler 文件：`agent-handler`（`/agent add`、`/agent rm`）、`help-handler`（`/help`）、`permission-handler`（`/permission mode`、`/permission auto`）、`session-handler`（会话创建/绑定/切换/prompt/cancel/status）、`session-recovery-handler`（会话创建失败渲染与恢复）、`session-reset-handler`（`/session reset`）、`session-shortcut-handler`（`/session shortcut`）、`workspace-handler`（`/workspaces`、`/workspace new`、`/workspace rm`）。`command-router.ts` 本身转为轻量调度层。
- `tests/unit/commands/command-router.test.ts`（约 900 行）拆分为 `command-router-config.test.ts`、`command-router-interaction.test.ts`、`command-router-recovery.test.ts`、`command-router-session.test.ts` 四个专项测试文件，并抽取 `command-router-test-support.ts` 共享测试辅助函数。
- `SessionTransport` 接口移除已废弃的 `listSessions()` 方法，同时从 `acpx-cli` 与 `acpx-bridge` 两个 transport 实现中移除对应逻辑。

### Fixed

- 修复 Windows 环境下媒体临时文件路径硬编码为 `/tmp/` 导致写入失败的问题。`process-message.ts` 改为使用 `os.tmpdir()`，并导出 `resolveMediaTempDir()` 供测试注入。
- `bridge-server.ts` 增强错误处理：抽取 `BridgeInvalidRequestError` 专门处理无效请求 ID 解析，将错误码区分为 `BRIDGE_INVALID_REQUEST` 与 `BRIDGE_INTERNAL_ERROR` 两类。

### Docs

- `AGENTS.md` 与 `CLAUDE.md` 更新构建命令说明，补充 `npx tsc --noEmit` 类型检查步骤与 `transport.permissionMode` 默认为 `approve-all` 的说明；同步更新 transport API 列表（新增 `setMode`，移除 `listSessions`）。

## [0.1.6] - 2026-03-31

### Added

- 新增会话 mode 管理命令：支持 `/mode` 查看当前逻辑会话已保存的 mode，并支持 `/mode <id>` 将 mode 透传到底层 `acpx set-mode`。
- 新增会话级 `transport_agent_command` 记录与恢复机制；当后端 session 丢失或 agent 命令变化时，可基于 transport session 索引恢复会话使用的实际 agent 命令。
- 新增 `/session reset` 指令及快捷别名 `/clear`，用于保留当前 alias、agent、workspace 的同时重建一个新的后端 session。

### Changed

- 命令路由现在会在创建、附加、重置逻辑会话后刷新并保存 transport 侧的 agent 命令；prompt 遇到 “No acpx session found” 时也会尝试恢复后重试一次。
- `SessionService` 与 transport 抽象已扩展为支持保存会话 mode、会话级 transport agent command，以及 bridge/cli 两种 transport 的 `setMode` 能力。
- `runConsole` 增强了 `SIGINT` / `SIGTERM` 的优雅退出处理；守护进程停止流程也增加了轮询等待与超时控制，减少残留进程与运行时文件未清理的问题。
- 默认配置模板补充了 `transport.permissionMode` 与 `transport.nonInteractivePermissions`，首次生成配置文件时会写入完整默认值。
- 测试脚本恢复了统一 test plan，先执行 `tsc --noEmit` 再逐个运行测试文件；同时补充了 `typescript`、`@types/bun` 与相关锁文件更新，保证本地 `npm test` 可直接通过。

### Docs

- 更新 `README.md`，补充 `/mode` / `/mode <id>` 的用法说明，并新增 adapter mode 参考说明。

## [0.1.5] - 2026-03-30

### Added

- ✨ **新增会话重置功能：** 引入了 `/session reset` 指令（及快捷别名 `/clear`），用于重置当前会话上下文，但保留当前的逻辑会话名称（alias）、智能体（agent）和工作区（workspace）。
- 🛑 **完善优雅退出机制：** 在控制台运行入口 (`runConsole`) 中添加了对 `SIGINT` 和 `SIGTERM` 信号的监听，通过 `AbortController` 通知 SDK 优雅关闭。
- ⏳ **守护进程关闭等待：** `DaemonController` 新增了停止守护进程时的轮询等待与超时机制，避免遗留僵尸进程或运行时文件清理不彻底。

## [0.1.4] - 2026-03-30

### Added

- 内置微信接入实现，不再依赖外部 `weixin-agent-sdk` 包完成运行时加载；仓库内新增登录、鉴权、消息收发、媒体处理、监控与存储相关模块。
- 新增微信二维码登录流程与本地账号凭证管理，包括账号索引、按账号保存凭证、登录状态检测，以及清理本机微信凭证的能力。
- 新增 `weacpx logout` CLI 命令；微信侧也增加 `/logout` 与 `/clear` 内置指令。
- 新增微信消息媒体链路，支持处理图片、视频、文件与语音消息，并支持将 Agent 返回的媒体文件回传到微信。
- 新增微信输入中间态与流式回复支持，长任务执行时可分段回传 Agent 的中间输出，而不是只在结束后返回最终结果。
- 新增权限策略命令：`/pm`、`/permission`、`/pm set allow|read|deny`、`/pm auto allow|deny|fail`。

### Changed

- `acpx-cli` 与 `acpx-bridge` 两种 transport 现在都会传递权限模式参数，支持 `approve-all`、`approve-reads`、`deny-all` 以及非交互权限策略。
- 命令路由与 transport 提示链路已调整为支持流式回调，微信端可以接收 prompt 的阶段性输出。
- 配置模型扩展了 `transport.permissionMode` 与 `transport.nonInteractivePermissions`，并补充默认值与校验逻辑。
- `runConsole` 在启动微信通道前会自动检查登录状态；未登录时会触发扫码登录。
- prompt 异常处理增强，bridge/client/router 现在会保留并记录更完整的退出码、stdout/stderr 与 NDJSON 诊断信息。
- 发布元数据调整：`package.json` 增加 `publishConfig.registry`、`engines.node >= 22`，并收敛发布文件列表。

### Docs

- 更新 `README.md`，补充了 `login`/`logout` 用法、权限策略命令、微信内置指令、Transport 权限配置，以及流式回复行为说明。
