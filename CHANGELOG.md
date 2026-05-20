# Changelog

## [0.4.9] - 2026-05-21

### Added

- **并行 agent 委派（`parallel` opt-in）：** `delegate_request` 和 `delegate_batch` 的每个任务条目新增可选字段 `parallel: boolean`（默认 `false`）。设为 `true` 时，任务在独立的临时 acpx session 中与该 agent 的其他并行任务并发执行；任务到达终态且无待审核项后，该临时 session 自动关闭（`transport.removeSession` → `acpx <agent> sessions close <name>`）。`parallel: false`（默认）行为与以往完全一致，串行复用 agent 现有 session，无任何变化。
- **`orchestration.maxParallelTasksPerAgent` 配置项：** 新增整数配置字段（≥ 1，默认 `3`），全局限制每个 agent 同时运行的并行 slot 数量，跨所有 coordinator 和工作区计数。
- **`queued` 任务状态：** 当目标 agent 的并行 slot 已满时，新的 `parallel: true` 任务以 `status: "queued"` 创建，不占用 acpx session；有 slot 释放时自动按创建时间顺序升为 `running` 并开始执行。`queued` 任务计入 `maxPendingAgentRequestsPerCoordinator` 配额，可通过 `task_watch` / `task_get` 正常跟踪直至终态。
- **微信 channel 客户端标识头：** 出站请求新增 `iLink-App-ClientVersion`（uint32 编码的 semver）头；同时 `base_info` 新增 `bot_agent` 字段，从配置 `channels.openclaw-weixin.botAgent`（支持账号级覆盖）读取，经 UA 风格语法清洗与 256 字节上限。可选 `WEACPX_ILINK_APP_ID` 环境变量启用 `iLink-App-Id` 头，未设置时不发送（向后兼容）。
- **微信扫码登录配对码支持：** `pollQRStatus` 识别 `need_verifycode` / `verify_code_blocked` 两种状态。前者从交互式终端读取 6 位配对码并附在下次轮询的 `&verify_code=` 上；后者刷新二维码并清除暂存的配对码，连续 `MAX_QR_REFRESH_COUNT` 次锁定后放弃。新增 daemon 模式 TTY 守卫——缺少交互终端时立即放弃登录而不挂死。
- **文档：** `docs/config-reference.md` 新增"微信频道扩展配置（`openclaw.json`）"段，记录 `routeTag`（既有，长期未文档化）/ `botAgent`（新增）/ 账号级覆盖结构 / `OPENCLAW_CONFIG` 环境变量；环境变量表追加 `WEACPX_ILINK_APP_ID`。

### Changed

- **微信回复 Markdown 过滤改为流式状态机：** `markdownToPlainText` 由贪婪 regex 替换为字符级状态机（`StreamingMarkdownFilter`，从 openclaw 借鉴）——保留代码围栏内容、表格分隔行、行内反引号、`**` 加粗与非 CJK 斜体；仅在 CJK 语境剥离 `*` / `***` / `_` / `___` 斜体标记，剥离图片与 H5/H6。修复长期存在的代码块与表格被吞问题。`markdownToPlainText` API 签名不变，所有调用点零改动。

### Fixed

- **微信 contextToken 落盘持久化：** `contextToken` 现在每次 `setContextToken` 写入磁盘（`<stateDir>/openclaw-weixin/accounts/<id>.context-tokens.json`），`bot.start()` 时 `restoreContextTokens` 读回内存，`bot.logout()` 时清理对应账号。修复 daemon 重启后首条 outbound 回复因 `contextToken is required` 直接失败。新增 `findAccountIdsByContextToken` 供编排投递路径反查发送账号。
- **resolvePluginHome 防御字符串化的 undefined/null：** 当 `input.home` / `input.pluginHome` / `WEACPX_PLUGIN_HOME` / `process.env.HOME` 被传成字面字符串 `"undefined"` 或 `"null"` 时，旧 `??` 守卫视其 truthy 保留，导致 `join("undefined", ".weacpx", "plugins")` 在 CWD 下材化出 `undefined/.weacpx/plugins/`。现统一归一化为缺省值让 `??` 正确 fall-through 到 `homedir()`。同时清理 `73b08c1`（0.4.7）误提交的 `undefined/.weacpx/plugins/package.json` 并加入 `.gitignore`。

## [channel-feishu 0.1.2] - 2026-05-19

> `@ganglion/weacpx-channel-feishu` 单独发布；weacpx 本体保持 `0.4.8` 不变。

### Added

- **飞书卡片思考过程展示：** 飞书 channel 现在把 acpx 的 `agent_thought_chunk`（经 0.4.8 引入的 `onThought` 侧通道）渲染进流式卡片里一个**始终折叠**的 `🧠` 面板，header 显示「已思考 N 秒」（首个到最近一个思考片之间的活动跨度）。`onThought` 为优先数据源，回答文本内嵌的 `<think>` / `<thinking>` / `<thought>` 标签解析作为回落，兼顾走侧通道的 acpx 与内嵌标签的 agent。static（非卡片）模式不展示思考，与 `onToolEvent` 行为一致。

### Changed

- **思考面板形态：** 思考面板从常驻展开的普通 markdown 元素改为始终折叠的 `collapsible_panel`，与工具调用面板形态一致；思考内容变化时强制走全量 `card.update`，确保折叠面板内容刷新。

## [0.4.8] - 2026-05-19

### Added

- **`onThought` 思考侧通道：** 新增结构化的 `onThought` 侧通道，把 acpx 的 `agent_thought_chunk`（代理推理）作为原始 chunk 透传给注册了 `ChatRequest.onThought` 的 channel / 插件；`acpx-cli` 与 `acpx-bridge` 两种 transport 均支持。思考与回答文本分流，内置微信 channel 不展示思考，channel 可按需消费。
- **bridge 协议 `prompt.thought` 事件：** bridge 协议新增 `prompt.thought` 流式事件，bridge-runtime / bridge-server / bridge-client 一路转发，使 bridge 模式会话也能把推理 chunk 透传给 channel runtime。

### Changed

- **tool_call_update 渲染回落 `rawOutput`：** 工具调用更新摘要在 `rawInput` 没有可展示文本时回落到 `rawOutput`，避免 verbose 模式下工具调用细节为空。
- **daemon/runtime 路径尊重 `WEACPX_CONFIG`：** daemon 与 runtime 路径解析现在跟随 `WEACPX_CONFIG`，使用替代 config 路径时，daemon 状态、日志与 doctor 检查都落到对应的 `runtime/` 目录。
- **微信账号发现回落已有凭证：** 二维码登录的账号索引缺失或过期时，微信账号发现回落到已有的凭证文件。
- **版本升级：** `weacpx` 升至 `0.4.8`，`@ganglion/weacpx-channel-feishu` 与 `@ganglion/weacpx-channel-yuanbao` 升至 `0.1.1`。

### Fixed

- **飞书出站 mention 归一化：** 发送前统一 `<at id=...>` / `<at open_id=...>` 等 mention tag 变体，修复飞书出站 @ 处理。
- **飞书瞬时错误有限重试：** 飞书消息发送、媒体上传、媒体下载遇到 502 / 503 / 504 瞬时错误时增加有限重试。
- **元宝流式 Markdown 修复：** 修复元宝流式 Markdown 拼接——修复断裂的管道表格、保留代码/数学块、拆掉只含表格的 markdown fence，并避免 flush 不完整的表格/fence 内容。
- **发布 CI 修复：** 依赖升级后同步 `package-lock.json`，并在根 publish workflow 中统一使用 `npm ci`。

## [0.4.7] - 2026-05-18

### Added

- **`/session tail [N]` 命令：** 补拉当前会话的历史输出，用于 in-flight checkpoint 可视化。acpx-cli 与 acpx-bridge 两种 transport 均支持，默认 50 行，上限 500 行。
- **acpx 0.8.0 升级：** `acpx` 依赖从 `^0.6.1` 升级到 `^0.8.0`。
- **transport.permissionPolicy 支持：** 配置中新增 `transport.permissionPolicy` 字段，用于透传 `--permission-policy` 到 acpx 命令行。acpx-cli 与 acpx-bridge 两种 transport 均支持。`/config set transport.permissionPolicy` 可热更新。
- **tool_call_update 结构化事件增强：** `ToolUseEvent` 新增 `locations`、`rawOutput`、`content` 可选字段，streaming prompt 解析层从 acpx `tool_call_update` 事件中透传。
- **queue-owner payload 增强：** `QueueOwnerPayload` 新增 `promptRetries` 与 `sessionOptions`（含 `model`、`allowedTools`、`maxTurns`、`systemPrompt`）字段，支持更细粒度的 queue owner 会话配置。

### Changed

- **acpx 升级后 transport 命令参数适配：** `acpx-cli` 与 `acpx-bridge` 两个 transport 在生成 acpx 命令行参数时，条件注入 `--permission-policy` flag；当值为非空字符串时才注入。
- **bridge runtime permissionPolicy 透传：** `BridgeRuntimeOptions` 扩展 `permissionPolicy` 字段；`updatePermissionPolicy` 接口同步扩展；`buildPermissionArgs` 在 bridge 侧注入 `--permission-policy`。

## [0.4.6] - 2026-05-18

### Changed

- **MCP 工具面收敛 16 → 11。** `task_wait` 并入 `task_watch`(见下);`task_reject` 并入 `task_cancel` —— `task_cancel` 现在能取消任何非终态任务,取消一个尚未批准的任务等同于拒绝;`group_new` / `group_get` / `group_list` / `group_cancel` 四个工具替换为单个 `delegate_batch`:传一个任务数组即可,底层自动建组,整批结果一次性回注,无需协调者手工维护 groupId 状态机。
- **MCP 提示词三层去重。** 流程指引此前在 server instructions、工具 `description`、结果 `Next:` 文本里各讲一遍;现在以结果 `Next:` 文本为唯一权威来源,instructions 与 description 收敛为"做什么 + 何时用"。

### Removed

- **`task_wait` 工具。** 它是 `task_watch(mode=until_attention_or_terminal)` 的真子集 —— 后者同样阻塞到 attention/terminal,并额外内联返回事件流与任务快照。迁移:用 `task_watch` 替代;阻塞等待用 `until_attention_or_terminal` 模式,超时后以 `afterSeq=nextAfterSeq` 续轮询。注意默认超时由 5 分钟变为 1 分钟(可用 `timeoutMs` 调整,上限 20 分钟)。
- **`coordinator_follow_up_human_package` 工具。** 多轮人工问询改为:解决当前问询包后,用 `coordinator_request_human_input` 重新发起。

### Added

- **`delegate_batch` 工具。** 一次派发多个子任务;2 个及以上自动归入一个组,整批终态后结果一并回注。单个失败的任务带 `error` 字段返回,不影响其余任务。

## [0.4.5] - 2026-05-17

### Added

- **MCP 任务编排与 agent CLI：** 新增 agent CLI 与 MCP task 支持，coordinator 可通过 `delegate_request` 派遣子任务，并用原生 MCP task handle（`tasks/get` / `tasks/result` / `tasks/list` / `tasks/cancel`）跟踪。
- **acpx 内置 agent 模板：** 新增 acpx built-in agent templates，开箱即用地配置 codex / claude / gemini / opencode 等 agent。
- **`task_watch` 事件流编排：** 新增 `task_watch` 长轮询工具，基于 `afterSeq` / `nextAfterSeq` 事件游标推进；任务事件持久化为 `events[]`（200 条环形缓冲），支持 `next_event` 与 `until_attention_or_terminal` 两种模式。
- **委派进度可见：** MCP task 现在透传 worker 的实时进度（`[PROGRESS]` 行解析），coordinator 无需阻塞即可观察子任务进展。

### Changed

- **避免 MCP task 自动阻塞：** 派遣后默认返回 `running` 句柄，不再自动进入 `input_required` 等待；提示词引导优先用 `task_get` / `task_watch` 做非阻塞快照，仅在显式需要时调用 `task_wait`。
- **MCP task / agent CLI 加固：** 收紧进度解析边界、watcher 缓存上限（256）与超时钳制，修复独立进度段及正常输出后的进度行解析。

### Fixed

- **委派结果文本截断：** `extractPromptOutput` 此前只保留最后一段连续的 `agent_message_chunk`，worker 在回答中途调用工具会导致回复被切碎、只剩尾部片段。现在按顺序拼接所有消息块，跳过中间的工具调用/思考/非 JSON 噪声行。
- **MCP contested task 状态：** 修正争议复核任务的状态流转。

### Tests

- 新增 agent CLI、MCP server / tools / transport、orchestration server/service、progress-line-parser、`task_watch` 等套件的单元测试；更新 prompt-output / bridge-server / acpx-cli-transport 用例断言完整回复。

## [0.4.4] - 2026-05-15

### Added

- **Perf debug mode for Weixin turns:** 新增 `logging.perf.enabled` 开关，开启后把一次 Weixin 入站消息的关键耗时写入独立的 `~/.weacpx/runtime/perf.log`，包括 `turn.received`、`agent.dispatched`、router/session/transport checkpoint、reply 文本发送与 `turn.done` 汇总。默认关闭。
- **出站媒体性能标记：** Weixin outbound media 发送现在记录 `reply.media_sent` / `reply.media_done`，提供安全路径校验 + Weixin CDN 上传 + 媒体消息发送的粗粒度真实耗时与 sent/failed/rejected/dropped 汇总。

### Changed

- **日志滚动复用：** app log 与 perf log 共用抽出的 rotating-file writer helper，但各自保持独立 write chain，避免互相阻塞。
- **Runtime paths 暴露 perf log 路径：** `resolveRuntimePaths()` 现在包含 `perfLogPath`，`buildApp()` 使用该路径初始化 perf tracer。

### Fixed

- **Perf outcome 语义修正：** prompt abort / 已 abort / turn AbortError 不再误记为 error；transport 层用 `localOutcome` 区分 `ok` / `error` / `aborted`，Weixin turn AbortError 记录为 `outcome="aborted"` 并跳过错误通知。
- **`/session attach` perf 完整性：** attach 已存在 transport session 成功后也会发出 `session.ready` mark，与新建 session 路径保持一致。
- **Perf 故障降级：** perf log 连续 IO 失败后 tracer 进入 noop，且 app log breadcrumb 写入失败也不会产生 unhandled rejection 或影响业务。

### Docs

- 更新 `config.example.json`、`docs/config-reference.md`、`docs/commands.md`、`docs/config-command.md`，说明 `logging.perf.*` 配置、重启生效限制，以及 `/config set` 不支持动态修改 perf logging。

### Tests

- 新增 perf tracer / writer / buildApp / ConsoleAgent / CommandRouter / Weixin turn 覆盖，包括正常 prompt lifecycle、error/abort 负路径、outbound media rejected、`/session attach` `session.ready`、permanent failure noop 与 appLogger rejection 防护。

## [0.4.3] - 2026-05-15

### Changed

- **MCP 工具引导更完整：** 给 weacpx MCP server 加上"完整生命周期"引导，让外部 coordinator agent（Claude Code / Codex / OpenCode 等）不再因为不知道下一步该调用哪个工具而卡住。三层叠加：
  - **Server-level `instructions`**：新增 `WEACPX_MCP_SERVER_INSTRUCTIONS` 常量，通过 MCP `Server` 第二参数下发完整生命周期说明（delegate → wait → 按 `attention_required` 子状态分支 → 续 wait → task_get 汇报；含 `task_approve` 后回到 wait 的循环；含 batching / cancellation / discovery 等辅助路径）。
  - **每个工具的 `description` 加 "Use after X / before Y"**：`delegate_request`、`task_wait`、`task_get`、`task_approve` / `task_reject`、`task_cancel`、`coordinator_answer_question`、`coordinator_review_contested_result`、`worker_raise_question`（标注 "Worker-side only"）、group_* 全部加上指向下一步的工作流提示。
  - **结果文本里加 `Next:` 提示**：`renderDelegateSuccess`（按 `running` / `needs_confirmation` 分支）、`renderTaskWaitResult`（按 `terminal` / `attention_required` / `timeout` 分支；`attention_required` 进一步按 `needs_confirmation` / `blocked or waiting_for_human` / `reviewPending` 路由到对应工具）、`renderTaskApprovalSuccess`（指向 `task_wait`）都会在返回里追加 `Next:` 行。
- **External coordinator MCP registry 过滤：** `coordinator_request_human_input` 与 `coordinator_follow_up_human_package` 对 external coordinator 会硬抛 `"human input routing is not configured for external coordinator"`。MCP server 现在在 identity 解析时识别 external 会话（通过 `prepareMcpCoordinatorStartup` 的 `kind === "external-coordinator"`），并在 `buildWeacpxMcpToolRegistry` 阶段把这两个工具过滤掉，registry 规模从 16 → 14。Internal coordinator（WeChat 逻辑 session 走 MCP 的少见路径）保持 16 个工具不变。

### Removed

- **`OrchestrationTaskStatus` union 删除 `"pending"`：** 调查确认无任何代码路径会把 `task.status` 写成 `"pending"`（13 处 `task.status =` 赋值全部走其它分支；两个 task 构造点只用 `running` / `needs_confirmation`；`RecordWorkerReplyInput.status` 类型收窄到 `completed | failed | cancelled`；`previousStatus` 恢复路径前已 `assertNeedsConfirmation`）。同步清理 `state-store.ts isTaskStatus` 校验器、`isAttentionRequiredTask` 预判、`pendingApprovalTasks` 计数器、MCP `taskStatusSchema` / cast、`orchestration-server` 的 task list filter enum、以及一个 test fixture / test helper。**保留**所有 `"pending" | "running" | "terminal"` 的 group 过滤器（这是另一个语义层："组里有待审批任务"）。

### Tests

- 新增 MCP 工具引导覆盖：`delegate_request` running-path 的 `Next:` 提示、`task_wait` 三种 status 各自的 `Next:` 文本、`task_wait` 描述里 attention_required 子状态分支、`task_approve` 结果文本的 `task_wait` 链接、server `instructions` 的关键关键字（含 approval loop "After task_approve, return to step 2"）。
- 新增 external / internal coordinator registry 区分覆盖：external 走 `buildWeacpxMcpToolRegistry` 返回 14 工具且不含两个 human-input 工具；internal 返回 16 工具且都含；`createMcpStdioIdentityResolver` 在 existing-session 路径不带 `isExternalCoordinator` 字段。
- 负向断言保证回归：attention_required 文本里禁止再出现 `pending or needs_confirmation` 或 `coordinator_request_human_input`；`task_wait` 描述里禁止出现 `coordinator_request_human_input`；server `instructions` 同步约束。

## [0.4.2] - 2026-05-14

### Changed

- **首次启动等待 UI：** `weacpx start` 在 onboarding 后进入“正在创建初始会话”阶段时，TTY 下显示带 spinner 的等待行（`elapsed / timeout`），超过 20s 追加“首次启动可能需要准备依赖和运行环境”提示，并支持按 `Ctrl+B` 跳过等待、`Ctrl+C` 正常中断；非交互环境保持静默回退。
- **启动失败诊断更完整：** `weacpx start` / `weacpx restart` 失败时除 `Stderr` 路径外，新增打印 `App Log` 路径（`~/.weacpx/runtime/app.log`），方便第一时间定位首次启动失败原因。

### Tests

- 新增 `tests/unit/cli-startup-wait-ui.test.ts` 覆盖等待行渲染、Ctrl+B 跳过、Ctrl+C 中断与非交互回退；扩充 `tests/unit/cli.test.ts` 与 `tests/unit/daemon/daemon-controller.test.ts` 覆盖 `startupWait` 透传以及失败路径下的 App Log 提示。

## [0.4.0] - 2026-05-14

> 🎉 **正式发布。** `npm install weacpx` 现在默认获取 0.4.0；channel 插件 `@ganglion/weacpx-channel-feishu` 与 `@ganglion/weacpx-channel-yuanbao` 同步升至 `0.1.0` 正式版。0.4.0-beta.0 引入的 channel/plugin 架构、CLI 与发包工具链请见下方 beta.0 条目，本条目记录 beta 系列以来的增量改动。

### Added

- **Feishu channel 流式卡片体验：** `@ganglion/weacpx-channel-feishu` 新增 streaming card + abort + typing + permission UX，引入 ToolUseStore 与可折叠的 tool-use 面板、实时刷新的 elapsed 页脚、进程级 shutdown 钩子注册表；卡片在关停时优雅终止并保留终态，避免遗留半成品卡片。
- **Yuanbao channel 群组与媒体能力：** `@ganglion/weacpx-channel-yuanbao` 新增群历史抓取、引用解析、@-bot 自动回复识别，inbound 图片/文件下载到 `mediaStore`；outbound 改为 markdown-aware 队列并支持 merge-text 策略；日志脱敏、引用回执去重与 abortSignal 线程化。
- **Transport tool-event 结构化侧通道：** 新增 `ToolUseEvent`/`ToolUseKind` 公开类型，acpx-cli 与 acpx-bridge 串行化 `onToolEvent` 回调，prompt 接口新增 `toolEventMode`（`text` / `structured` / `both`）；bridge 协议、router、agent 一路转发结构化事件，channel 实现可按需消费。
- **`formatToolUseEventForText` 与 `TOOL_KIND_EMOJI`：** 共享文本渲染 helper，避免 channel 间漂移；channel 也可继续仅消费 `onText` 走 best-effort 文本路径。

### Changed

- **MCP stdio 加固：** `runWeacpxMcpServer` 在 Windows 上正确响应 SIGINT/SIGTERM/SIGBREAK、stdin EOF 与父进程消失；shutdown 诊断改为单火（一次事件一次日志），3s force-exit 兜底保留。
- **MCP 工具响应清理：** `coordinator_request_human_input` / `coordinator_follow_up_human_package` 触发 `QuotaDeferredError` 时不再把内部 `chatKey` 透传到 `structuredContent`；`formatToolError` 优先按 `error.code` 识别连接失败（`ECONNREFUSED`/`ENOENT`/`ECONNRESET`/`EPIPE`），不再依赖错误文本正则。
- **MCP transport 一致性：** `delegateRequest`、`listTasks` 的 optional 字段统一用 `!== undefined`，避免未来增加 boolean 字段时被 truthy 检查吞掉 `false`。
- **MCP CLI flag 解析合并：** `--coordinator-session` / `--source-handle` / `--workspace` 三个 100% 重复的解析模板抽成共享 `parseStringFlag`；现有 env/CLI 行为不变。
- **Reply mode 默认值：** Feishu channel 默认 `replyMode: "auto"`，与微信路径保持一致；reply quota 仅在微信路径生效，其他 channel 不再被 quota 限制。
- **Verbose tool 输出修复：** transport 在 `session.replyMode` 未定义时也会应用 `formatToolCalls`，避免 verbose 模式下工具调用细节被吞掉。

### Fixed

- **微信 state dir 在 Windows 上的创建：** 修复跨平台路径解析问题，避免初次启动时因目录缺失导致状态文件写入失败。
- **Feishu streaming card 抢占：** seed-during-abort 竞态、element 快路径正文截断到 `maxChars`、多卡片并发 abort 期间的 authorization 取消；卡片 footer 在终态下保留 elapsed 文本不被覆写。
- **`inferWorkspaceFromRoots` 弃用标记：** MCP identity resolution 主流程已不再走 MCP roots 推断，函数加 `@deprecated` JSDoc 提示未来移除。

### Tests

- 新增 transport `toolEventMode` / `formatToolUseEventForText` / acpx-bridge tool-event wire-format / acpx-cli onToolEvent-only 等覆盖；扩充 channel-feishu streaming card 的 shutdown reset、ToolUseStore、tool panel、live elapsed 测试；新增 channel-yuanbao 群组历史、媒体、markdown 队列、abort 测试。
- 更新 `tests/unit/mcp/weacpx-mcp-server.test.ts` 中 shutdown-hooks 测试断言为单火语义；更新 `tests/unit/mcp/weacpx-mcp-tools.test.ts` 的 `deferred_quota` 结构化内容不再包含 `chatKey`。

### Docs

- 更新 `docs/config-reference.md` 与 `packages/channel-feishu/README.md` 反映 Feishu streaming card / tool-use panel / shutdown 钩子配置。
- `src/transport/types.ts` 与 `src/transport/tool-use-text-format.ts` 的代码注释补充 `toolEventMode` / `onToolEvent` 的异步语义，以及 `formatToolUseEventForText` 作为 best-effort 文本适配器的边界说明。

## [0.4.0-beta.0] - 2026-05-11

> ⚠️ **预发布版本（prerelease）。** 通过 `npm install weacpx@next` 或 `npm install weacpx@0.4.0-beta.0` 获取；`npm install weacpx`（默认 `latest` 标签）仍指向 0.3.x 稳定版。本次为新插件架构的首个公开预览，欢迎试用反馈，正式版预计随 0.4.0 一同发布。

### Added

- **Channel 插件运行时：** 新增 `weacpx/plugin-api` 公开入口，配套 `src/channels/` 与 `src/plugins/` 提供 channel 注册表、scope、媒体存储、出站媒体安全校验、插件加载/校验/诊断/CLI、known-plugins 列表，外部 npm 包可在不依赖内部模块的情况下实现自定义 channel。
- **channel-feishu / channel-yuanbao 拆分：** 飞书与腾讯元宝 channel 独立为 `@ganglion/weacpx-channel-feishu`、`@ganglion/weacpx-channel-yuanbao`，仅依赖公开的 `weacpx/plugin-api`，按需 `npm install` 即可启用。
- **Channel/Plugin CLI：** 新增 `weacpx channel|ch list|show|add|rm|enable|disable [--account <id>]` 与 `weacpx plugin list|add|update|remove|enable|disable|doctor|known`，支持多账号 bot 与第三方插件管理；新增 `weacpx restart` 守护进程重启子命令，并提供更友好的启动失败提示。
- **Command Policy：** 新增 `command-list` / `command-policy`，slash 命令现在按 channel / 权限策略声明式启用，便于不同 channel 暴露不同命令面。
- **DebouncedStateStore：** 新增防抖 state store，将突发的状态变更聚合为单次磁盘写入，保留 last-write-wins 语义。
- **发包验证工具链：** 新增 `scripts/verify-publish.mjs`（基于 `bun pm pack --dry-run` 的多包内容/peer-dep/exclusion 校验）、`scripts/smoke-local-install.mjs`（把三个 tarball 装进临时项目并跑 `weacpx --version`），以及 `bun run verify:publish` / `publish:plugins` 脚本。
- **Bun workspace + plugin-api 构建：** 仓库切换为 bun workspace，根包与 `packages/channel-*` 同源；新增 `tsconfig.plugin-api.json` 与 `build:plugin-api` 让 `weacpx/plugin-api` 同时输出 `.js` 与 `.d.ts`。
- **新增文档：** `docs/channel-management.md`、`docs/plugin-development.md`、`docs/code-wiki.md`，更新 README/AGENTS/commands/config-* 反映新的 channel/plugin 架构。

### Changed

- **配置结构升级：** `wechat.replyMode` 被更通用的 `channel` 配置块取代（`type`、`replyMode`、channel 专属 `options`），并新增 `plugins`、按 channel 的运行时配置；旧的 `wechat.replyMode` 字段仍可通过兼容路径加载。
- **运行时全面接入 ChannelRuntime：** `buildApp`、`runConsole`、`console-agent` 注入 `MessageChannelRuntime`，编排进度/协调器消息/任务完成通知统一通过已注册的 channel 路由，不再硬编码到微信路径。
- **微信路径迁移到共享 channel API：** 微信 messaging、monitor、agent、quota-manager 改用 `src/channels/` 的媒体存储、出站媒体安全校验、入站媒体描述符、账号路由等共享能力；bridge runtime/server、transport prompt-media、sessions service、mcp server/tools、orchestration service、doctor smoke-check、logging 同步对齐。
- **私有文件原子写入加固：** `private-file.ts` 用 `proper-lockfile` + `write-file-atomic` 替换手写实现，并发写入串行化、Windows AV/EPERM 抖动可重试，写入完成后强制 `fsync`。
- **Plugin compat：** 兼容性比较时把当前 weacpx 版本中的预发布后缀视为其基础发行版（如 `0.4.0-beta.0` 视为 `0.4.0`），插件作者无须为每个 prerelease tag 额外声明。
- **版本升级：** weacpx 升至 `0.4.0-beta.0`，`@ganglion/weacpx-channel-feishu` / `@ganglion/weacpx-channel-yuanbao` 均为 `0.1.0-beta.0`，channel 包的 `peerDependencies.weacpx` 收紧到 `>=0.4.0-0`，要求 weacpx 0.4.x 起的核心 API。

### Fixed

- **`readVersion` 安装/开发布局兼容：** `src/version.ts` 同时支持 `dist/cli.js → ../package.json` 与 `src/version.ts → ../package.json` 两种布局，避免在 `npm install` 后无法读取版本。
- **跨平台 `run-tests` 脚本：** Windows 下使用 `npx.cmd` 与 `shell: true` 启动子进程，避免 ENOENT。

### Tests

- 新增 `tests/unit/channels/`（registry/scope/media-store/cli/plugin-boundary/weixin-channel/moved-channel-hints）、`tests/unit/plugins/`（loader/validator/doctor/cli/compatibility/known-plugins/package-manager/config/api-types）、`tests/unit/packages/`（channel-feishu / channel-yuanbao 的 channel/config/inbound/media/plugin/send/provider）等覆盖。
- 新增 `tests/unit/util/private-file.test.ts`、`tests/unit/cli-help.test.ts`、`tests/unit/commands/command-policy.test.ts`、`tests/unit/scripts/verify-publish.test.ts`、`tests/unit/version.test.ts`，并扩充 cli/main/run-console/orchestration/sessions/transport/weixin 现有测试以覆盖 channel runtime 注入。

### Docs

- 新增 `docs/channel-management.md`、`docs/plugin-development.md`、`docs/code-wiki.md`；更新 README、AGENTS、`docs/commands.md`、`docs/config-command.md`、`docs/config-reference.md`、`docs/developments.md` 反映新的 channel/plugin 命令面与 workspace 发包流程。

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
