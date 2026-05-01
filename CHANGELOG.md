# Changelog

## [0.3.2] - 2026-05-01

### Added

- **外部 MCP 协调器自动发现：** `weacpx mcp-stdio` 现在支持自动从 MCP roots 推断工作区并生成协调器会话标识，`--coordinator-session` 参数变为可选；新增 `inferExternalCoordinatorSession` 与 `inferWorkspaceFromRoots` 智能推断逻辑。
- **任务等待工具：** 新增 `task_wait` MCP 工具，支持 worker 轮询等待任务完成或需要人工介入，带可配置的超时与轮询间隔上限。
- **Prompt 媒体支持：** Transport prompt 接口新增 `PromptMedia` 类型，支持图片文件作为结构化 prompt 输入，自动进行 MIME 类型检测与大小校验。
- **外部协调器注册：** 编排服务新增 `registerExternalCoordinator` 方法，支持外部 MCP 客户端注册为协调器，与现有 worker/session 机制隔离。

### Changed

- **版本升级至 0.3.2**，`acpx` 依赖升级至 `^0.6.1`。
- **编排服务并发安全增强：** `OrchestrationService` 与 `SessionService` 新增 `AsyncMutex` 状态锁，避免并发操作导致状态不一致。
- **`mcp-stdio` 命令增强：** 新增 `--workspace` 参数支持，协调器会话与工作区绑定逻辑更完善，启动前会校验 workspace 配置有效性与会话冲突。
- **README 文档更新：** 精简项目定位说明，补充外部 MCP 接入说明与更多 Agent 支持。

### Tests

- 新增 `infer-coordinator-identity`、`parse-coordinator-workspace`、`prompt-media`、`task-wait-timeouts`、`weacpx-mcp-transport` 等单元测试。
- 大幅扩充 `orchestration-service`、`orchestration-client`、`orchestration-server`、`session-service`、`state-store`、`bridge-server`、`cli`、`main`、`acpx-cli-transport`、`acpx-bridge-transport`、`handle-weixin-message-turn` 等测试覆盖。

### Docs

- 新增 `docs/external-mcp.md`：外部 MCP 协调器接入指南。

## [0.3.1] - 2026-04-28

### Added

- **本机 Workspace CLI：** 新增 `weacpx workspace list|add|rm`，并支持 `weacpx ws ...` 简写，可直接把当前终端目录注册到 `~/.weacpx/config.json`，方便在微信里通过 `--ws <name>` 引用常用项目。

### Changed

- **版本升级至 0.3.1。**
- **配置与状态文件写入更安全：** `config.json` 与 `state.json` 改为私有权限的原子写入，减少写入中断导致文件损坏或权限过宽的风险。
- **State 解析更严格：** 加强 session 与 chat context 结构校验，状态文件异常时会给出更明确的诊断信息。
- **进程终止语义更准确：** 区分 detached 进程组与普通子进程，避免误用负 PID 终止非 detached 子进程；acpx CLI 超时时会主动 abort 底层命令。
- **README 使用说明更新：** 精简项目定位说明，并补充 workspace CLI 用法。

### Fixed

- **日志脱敏增强：** JSON 日志体会自动遮蔽 token、signature、context token 以及用户消息正文，避免敏感内容落盘。
- **出站媒体路径收紧：** Agent 返回的远程媒体 URL 不再被自动下载发送，本地媒体也必须位于媒体临时目录或当前工作区内，避免越权读取/发送本机文件。
- **默认配置生成更稳健：** 当打包后的默认配置模板缺失时，会回退到内置默认配置。

### Tests

- 新增 workspace CLI、私有文件权限、state 校验、日志脱敏、媒体路径拦截、进程终止与 CLI 超时 abort 等单元测试覆盖。

## [0.3.0] - 2026-04-28

### Added

- **任务编排与多 Agent 委派：** 新增 `/delegate` / `/dg`、`/tasks`、`/task`、`/groups`、`/group` 系列命令，支持从当前主线会话委派子任务、查看任务状态、审批/拒绝待确认任务、取消任务以及按任务组批量管理。
- **MCP 编排服务：** 新增 `weacpx mcp-stdio --coordinator-session <session>`，为 acpx queue owner 注入 weacpx MCP tools，支持 worker 向 coordinator 回传结果、发起阻塞问题、请求人工输入与继续编排。
- **编排运行时与 IPC：** 新增 orchestration service/client/server、Unix/Windows IPC endpoint、任务/任务组持久化状态、worker 绑定、结果注入、coordinator 自动唤醒与进度心跳。
- **微信编排通知：** 新增任务完成/失败通知、worker 进度通知、coordinator 消息投递、跨账号通知选择，以及人工问题包/结果包渲染。
- **微信消息配额管理：** 新增按 chatKey 维护的 mid/final 消息预算、最终回复分页暂存、`/jx` 继续发送剩余内容、超额 heads-up 提示与配额事件日志。
- **缺失可选依赖恢复：** 新增 optional dependency 识别、父级 package 路径发现、自动安装与重试流程，降低 agent 运行时因缺依赖中断的概率。
- **诊断与文档：** `weacpx doctor` 新增编排健康检查；新增 `docs/commands.md`、`docs/weacpx-group-usage-guide.md`，并扩充配置、测试与 README 文档。

### Changed

- **版本升级至 0.3.0**，`acpx` 依赖升级至 `^0.5.3`，并新增 `@modelcontextprotocol/sdk`、`zod`、`zod-to-json-schema` 依赖。
- **默认微信回复模式改为 `verbose`：** `wechat.replyMode` 现在支持 `stream` / `final` / `verbose`，verbose 模式会展示更丰富的工具调用与进度信息。
- **Transport 提示链路增强：** prompt 支持传递 MCP 身份、桥接 `session.note`/`session.progress` 事件、工具调用格式化、分段聚合与配额门控。
- **配置与状态模型扩展：** 新增 `orchestration` 配置项、编排状态迁移与 state 结构校验，workspace 路径会进行更一致的规范化处理。
- **会话管理增强：** 新增 `/session rm <alias>`，移除会话时会检查活跃编排任务、清理 chat context，并在安全时释放底层 transport session。
- **守护进程与运行时路径增强：** runtime 目录现在同时用于 daemon 状态、日志与 orchestration socket；停止守护进程时改进进程树终止能力。
- **命令帮助与渲染更新：** `/help` 纳入编排主题，任务、任务组、进度、取消与错误信息以更结构化的中文文案展示。

### Fixed

- **Bridge/CLI 创建会话兼容性：** 当 acpx 不支持 `--verbose` 或 stderr 提示缺失可选依赖时，会自动降级/解析并给出可恢复提示。
- **长回复消息可靠性：** 修复超长最终回复一次性发送过多导致丢失的问题，改为预算内发送、剩余内容暂存并可通过 `/jx` 继续拉取。
- **Worker 结果注入可靠性：** coordinator 唤醒失败或消息配额耗尽时不再误标记任务结果为已注入，后续唤醒可重试。
- **微信发送错误诊断：** 对非 2xx 响应和 `errcode` 非 0 的响应统一封装，日志与提示中保留 endpoint、状态码和微信错误信息。

### Tests

- 新增 orchestration、MCP、quota、segment aggregator、optional dependency recovery、bridge protocol、微信通知与 `/jx` 等专项单元测试。
- 扩充 main/runtime、command router、state store、transport、doctor 和微信消息处理测试覆盖。

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
