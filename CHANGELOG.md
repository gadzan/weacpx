# Changelog

## [0.2.2] - 2026-04-13

### Added

- **Bridge 请求调度器：** 新增 `BridgeRequestScheduler` 模块，支持在 Bridge 侧对请求进行调度，使 `/cancel` 可以绕过卡住的 prompt 而不会与其他 cwd/agent 的请求冲突。

### Fixed

- **`/cancel` 会话恢复：** 当底层 transport session 丢失时（如进程异常退出），`/cancel` 会自动尝试恢复会话后再执行取消操作。
- **微信消息流阻塞：** 修复 normal 类型的微信消息在特定场景下被阻塞的问题，现在 `/cancel` 可以绕过阻塞继续执行。

## [0.2.1] - 2026-04-09

### Added

- **`weacpx doctor` 命令：** 新增本机环境诊断工具，默认检查 config / runtime / daemon / wechat / acpx / bridge 六个维度；支持 `--verbose` 展开技术细节、`--smoke` 执行真实 transport 级 prompt 检查、`--agent` / `--workspace` 指定 smoke 参数。
- **`weacpx version` 命令：** 新增版本查看，支持 `weacpx version`、`weacpx --version`、`weacpx -v` 三种写法。
- **CLI 新增 `--help` / `-h` 快捷参数。**

### Fixed

- **微信消息重复处理：** 新增滑动窗口去重机制，避免同一条消息被重复执行。
- **下划线内容被错误清理：** 修复包含下划线的 workspace 名称（如 `ec_fenqile_m`）和 Windows 路径在微信消息中被错误转换的问题。
- **会话快捷创建名称重复：** `/ss <agent> -d <path>` 生成的会话名不再重复包含 workspace 名（如 `weacpx:weacpx:codex` → `weacpx:codex`）。
- **Windows 下第三方文件锁导致会话创建失败：** 新增自动修复机制，当 `acpx sessions new` 因 EPERM 失败时自动恢复并重试。
- **Bridge transport 现已完整支持 Windows：** 会话创建不再依赖 Unix shell 脚本，直接调用 acpx。

## [0.2.0] - 2026-04-06

### Added

- **命令模块重构：** 将 `CommandRouter` 拆分为独立 handler 模块（`handlers/session-handler`、`handlers/agent-handler`、`handlers/workspace-handler`、`handlers/permission-handler`、`handlers/config-handler`、`handlers/help-handler` 等），提升可维护性和可测试性。
- **`/mode` 命令：** 新增 `/mode <modeId>` 和 `/mode show` 命令，支持在会话中切换 acpx 模式（如 code、plan 等）。
- **`/reply-mode` 命令：** 新增 `/reply-mode stream|final` 和 `/reply-mode show` 命令，支持按会话设置微信回复模式（流式分段回复或最终一次性回复）。
- **`/config` 命令：** 新增 `/config show` 和 `/config set <path> <value>` 命令，支持运行时查看和修改配置。
- **Bridge 流式 prompt：** Bridge 子进程新增流式 prompt 支持，通过 `prompt.segment` 事件实时回传中间输出；bridge server 新增 `setMode`、`updatePermissionPolicy` 方法。
- **消费者锁（Consumer Lock）：** 新增微信消费者锁机制（`consumer-lock`），防止多个 weacpx 进程同时消费微信消息，守护进程启动时自动获取锁，退出时释放。
- **会话索引解析：** 新增 `acpx-session-index` 模块，从 acpx sessions index 中解析 `agentCommand`，会话创建时自动记录并复用。
- **会话增强字段：** 逻辑会话新增 `transport_agent_command`、`mode_id`、`reply_mode` 字段，支持更完整的会话状态持久化。
- **`parseConfig` 导出：** `load-config` 的 `parseConfig` 函数现在公开导出，供 `ensure-config` 等模块复用。
- **`wechat.replyMode` 配置：** 新增 `wechat.replyMode`（`stream` | `final`）配置项，全局控制微信回复模式，默认 `stream`。
- **新增文档：** `docs/commands-module.md`、`docs/config-command.md`、`docs/daemon-module.md`。
- **新增测试：** bridge-env、bridge-runtime、command-router-config、command-router-interaction、command-router-recovery、command-router-session、ensure-config、run-console-consumer-lock、consumer-lock、execute-chat-turn、handle-weixin-message-turn 等。

### Changed

- **版本升级至 0.2.0**，acpx 依赖升级至 `^0.4.1`。
- **`nonInteractivePermissions` 默认值** 从 `"fail"` 改为 `"deny"`，同时移除了 `"allow"` 选项。
- **`SessionTransport` 接口变更：** 新增 `setMode`、`updatePermissionPolicy` 方法，移除 `listSessions` 方法。
- **Bridge server 请求校验增强：** 新增 `BridgeInvalidRequestError`，对 JSON 格式、字段类型、方法白名单进行严格校验，错误码区分 `BRIDGE_INVALID_REQUEST` 与 `BRIDGE_INTERNAL_ERROR`。
- **Bridge client 增强：** 新增 `terminalError` 状态，子进程退出后自动拒绝后续请求；writeLine 失败时直接 reject 而非静默忽略；支持流式事件分发。
- **`SessionService` 增强：** 新增 `getSession`、`setCurrentSessionMode`、`setCurrentSessionReplyMode`、`setSessionTransportAgentCommand` 方法；`toResolvedSession` 中对缺失的 agent/workspace 配置给出明确错误信息。
- **`StateStore` 增强解析：** 新增 `parseState` 函数，对 state JSON 进行结构校验，解析失败时给出更具诊断价值的错误信息。
- **守护进程状态区分：** `DaemonController` 新增 `indeterminate` 状态，当 PID 存在但状态文件缺失时阻止重复启动并给出明确错误提示。
- **进程树终止改进：** `terminateProcessTree` 现在使用进程组 ID（负 PID）发送信号，确保完整终止子进程树。
- **`runConsole` 消费者锁集成：** 启动时自动获取微信消费者锁，关闭时自动释放；冲突时记录详细日志。
- **微信消息处理重构：** 移除 `process-message.ts`，替换为 `execute-chat-turn.ts` 和 `handle-weixin-message-turn.ts` 模块。
- **命令路由测试重组：** 移除单一大文件 `command-router.test.ts`，拆分为 `command-router-session`、`command-router-config`、`command-router-interaction`、`command-router-recovery` 等专项测试文件。
- **package.json 描述更新：** `"使用微信 ClawBot 随时随地通过 acpx 控制 Claude Code、Codex 等 Agents。"`

### Removed

- 移除 `src/weixin/messaging/process-message.ts`（被新模块替代）。
- 移除 `nonInteractivePermissions: "allow"` 选项。
- 移除 `SessionTransport.listSessions` 方法。
- 移除 `render-text.ts` 中不再使用的辅助函数。
- 移除 `src/formatting/render-text.ts` 中的 `renderHelpText`、`renderAgents`、`renderWorkspaces`（迁移至各自 handler）。

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
