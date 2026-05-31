# 飞书频道实时会话切换 + 后台并发执行 设计

> 状态：设计已确认，待转 writing-plans。
> 关联：本特性是 [`2026-05-30-realtime-session-switching-background-execution-design.md`](2026-05-30-realtime-session-switching-background-execution-design.md)（微信渠道）在飞书插件上的移植，采用不同的卡片输出语义（见 §3）。

## 1. 背景与问题

weacpx 的「实时会话切换 + 后台执行」特性目前**只在微信渠道实现**（`src/weixin/`）。飞书是独立插件包（`packages/channel-feishu/`，与核心不同仓发版），有自己的一套**每聊天串行队列**（`packages/channel-feishu/src/chat-queue.ts` 的 `enqueueFeishuChatTask`）。

后果：飞书上当前会话任务执行中时，输入 `/ss <alias>` 切换会话**不会立即生效**——命令被 `enqueueFeishuChatTask` 串行排在正在跑的 prompt 之后，必须等任务跑完才执行。这是用户实测复现的 bug。

本设计把微信那套能力带到飞书，但因飞书的输出形态不同（流式交互卡片 vs 微信离散文字消息），采用了经确认的差异化语义。

## 2. 目标（已确认的语义决策）

| 维度 | 决策 | 说明 |
|---|---|---|
| 卡片语义 | **B：后台卡片就地流式跑到完成，切回不回放** | 飞书的卡片已发在聊天时间线里、本身就是完整结果，无需「攒最终结果、切回补发」 |
| 并发模型 | **A：真并发，每会话车道** | 不同 session 并行（多张卡同时流式、多个 acpx 同时跑），同 session 内串行 |
| 完成感知 | **完成提醒 + `/sessions` 列表 ●** | 复用 core 的 `background_results` 作「完成信号」 |
| 取消语义 | **现状不变 + `/cancel <alias>` / `/stop <alias>`** | 裸停止词仍走飞书现有发起者鉴权快速路径；新增 alias 精确取消（含后台），对齐微信 P2 |
| 车道逻辑归属 | **抽到核心共享模块，飞书引用** | 复用现有 `conversation-executor`（以后元宝等插件也能复用） |
| 会话绑定 | **复用 `peekCurrentSessionAlias` + `boundSessionAlias`** | dispatch-time 绑定，避免排队期间切会话导致 prompt 跑错会话 |

**核心成功标准**：飞书上任务执行中发 `/ss`、`/use`、`/cancel` 立即抢占生效；切走的会话在自己的卡片里继续跑到完成；同一聊天多个会话可真并发；后台完成有提醒 + 列表 ● 标记。

## 3. 与微信渠道的关键差异（B 语义带来的简化）

微信发**离散文字消息**，所以需要「前台输出闸门」（每次 send 判断 `shouldDeliverSegment`）和「切回回放」（把攒下的最终结果在 `/use` 时补发）。

飞书的每个 turn 有一张 `StreamingCardController` 驱动的**交互卡片**，已发在聊天时间线里、自始至终往自己那张卡写。因此 **B 语义砍掉两块微信复杂度**：

- **无前台输出闸门**：不需要 `foreground-gate` / `isForeground` 闭包 / send-time 判断。被切走的会话的卡片继续流式跑到完成。
- **无切回回放**：卡片本身就是完整结果，`/use` 切回**不**追加结果文本（不调 `takeBackgroundResult` 取 `text`）。

这是本设计与微信 spec 最大的架构区别，务必在实现时牢记：**飞书复用 core 的会话/状态/命令逻辑，但不复用 weixin 的 `foreground-gate` 与回放路径。**

## 4. 架构：三层改动

### 第一层 — 核心共享件（抽离，零逻辑改动）

`src/weixin/messaging/conversation-executor.ts` 本就是通用的（per-`sessionKey` 车道 + `control` 抢占车道，零 weixin 依赖）。

- **动作**：移动到中立位置 `src/runtime/conversation-executor.ts`；weixin 侧改 import 路径。
- **不改逻辑**：`createConversationExecutor` / `run(conversationId, lane, task, sessionKey?)` / `normalTails: Map<sessionKey, Promise>` / `DEFAULT_SESSION_KEY = "__chat__"` / `ConversationExecutorLane = "normal" | "control"` 全部原样保留。
- **契约**：不同 `sessionKey` 的 normal 任务各有独立 promise 尾、互相并行；同 `sessionKey` 串行；`control` 车道绕过 per-session 排队、微任务后立即执行（抢占在跑的 normal 任务）。

以下 core 件**已 channel-agnostic，直接复用，无需改动**：
- `SessionService`：`peekCurrentSessionAlias`、`setBackgroundResult`、`takeBackgroundResult`、`listBackgroundResultAliases`、`getResolvedSessionByInternalAlias`、`resolveFuzzyAlias`。
- `ActiveTurnRegistry`（`src/sessions/active-turn-registry.ts`）：`markActive` / `markInactive` / `isActive`。
- `BackgroundResult` + `ChatContextState.background_results`（`src/state/types.ts`）。
- `handleSessions`（列表 ● via `listBackgroundResultAliases` + `decorateUnread`）。
- `handleSessionUse` / `handleSessionUsePrevious`（切回 `takeBackgroundResult` 清除信号）。

> 注意：飞书命令路由是否经过这些 core handler，需在 writing-plans 阶段确认。飞书 `runTurn` 把命令交给 `agent.chat`，core 命令路由在其内部触发——即列表 ● 与切回清除应通过同一 `agent.chat` 路径自动生效。实现前需验证此假设（见 §8 风险）。

### 第二层 — 飞书 `start()` 接上 core 服务

飞书 `packages/channel-feishu/src/channel.ts` 的 `start(input: ChannelStartInput)` 当前只读 `agent` / `quota` / `logger`，**没读** `input.sessions`、`input.activeTurns`。

- **动作**：`start()` 读取 `input.sessions`、`input.activeTurns`，存到频道实例上并下传到入站管线（`handleMessageEvent` / `runTurn`）。
- 使飞书能调 `peekCurrentSessionAlias(chatKey)`、`setBackgroundResult(chatKey, ...)`、`activeTurns.markActive/markInactive`。
- `ChannelStartInput`（`src/channels/types.ts`）已声明这两个可选字段；`main.ts` 已创建单例 `activeTurns` 并经 `ChannelStartInput` 传入——核心侧**无需新增字段**，只需飞书侧消费。

### 第三层 — 飞书入站管线改造（主要工作量）

把 `chat-queue.ts` 的「每聊天串行队列」替换为共享的 `conversation-executor`。

入站消息（`channel.ts` `handleMessageEvent`）的分流：

1. **停止词快速路径**（现有 `tryHandleAbortTrigger`）：保持不变，仍在入队前拦截。
2. **斜杠命令**（`/` 开头）→ `conversationExecutor.run(convId, "control", task)`：**control 车道立即抢占**，不排在跑着的 prompt 后面。这是修 bug 的核心。
3. **prompt**（非斜杠）→ dispatch-time 读 `boundAlias = sessions.peekCurrentSessionAlias(chatKey)` 作 `sessionKey`，`conversationExecutor.run(convId, "normal", task, sessionKey)` 分车道；`boundAlias` 进 `agent.chat` 的 `metadata.boundSessionAlias`，让 acpx 跟当时绑定的会话跑（即使排队期间用户切走）。

每个 prompt turn 外层：
- 运行前：`if (boundAlias) activeTurns.markActive(chatKey, boundAlias)`。
- 完成后（`finally`）：`if (boundAlias) activeTurns.markInactive(chatKey, boundAlias)`。
- turn 结束时，若该会话**已非当前前台**（`peekCurrentSessionAlias(chatKey) !== boundAlias`）→ `setBackgroundResult(chatKey, boundAlias, { status, finished_at, text: "" })` 写「完成信号」+ 在当前前台聊天发完成提醒。

`queueKey` 的角色调整：飞书现用 `buildFeishuQueueKey(accountId, chatId, threadId)` 作串行键。改造后，`conversationExecutor` 的 `conversationId` 用 `chatKey`（或现 queueKey 等价物），`sessionKey` 用 `boundAlias ?? "__chat__"`。`activeTasks` 注册表的键保持现状（见 §5）。

## 5. 卡片与并发的取舍（已确认接受）

- **多张卡并发刷新**：同一聊天多个会话并发 = 多个 `StreamingCardController` 并行调 Lark CardKit API。每个 controller 自带 `FlushController`（限流批处理），各卡独立、不共享状态，**并发安全**。
- **多 acpx 并行**：acpx / transport 本就支持（微信渠道已验证）。
- **`activeTasks` 注册表保留**：飞书现有 `activeTasks: Map<queueKey, ActiveTask[]>`（存 `abortController` / `cardController` / `suppressed` / `senderOpenId`）继续用——它是 `/cancel <alias>` 与停止词快速路径定位在跑任务的依据。
- **两套注册表并存、不冲突**：
  - `activeTasks`（飞书本地）：定位**具体在跑的 task 对象**以做取消（需要 abortController/cardController 句柄）。
  - `activeTurns`（core 共享）：仅用于「完成感知」（`/sessions` 列表 ● + 提醒判断），只存 `(chatKey, alias)` 布尔。

## 6. `/cancel <alias>` 与完成感知

### `/cancel <alias>` / `/stop <alias>`
- 飞书命令解析层（飞书自有命令处理）加可选 `alias`。
- 解析到 alias → `resolveFuzzyAlias(chatKey, alias)` 定位会话 → 在 `activeTasks` 里找该会话（按 chatKey + 绑定 alias）对应的在跑 task → `abortController.abort()` + 卡片定格为「已取消」（`cardController.abort(...)`）。
- 裸 `/cancel` / 停止词 → 飞书现有发起者鉴权快速路径（`tryHandleAbortTrigger`）**不变**：只停发起者本聊天的在跑任务。
- 需在飞书的 `ActiveTask` 上记录其绑定的 session alias（新增字段），才能按 alias 定位。

### 完成提醒
- 后台 turn 跑完，在当前前台聊天发一条 `✅ <display-alias> 已完成`。
- **B 语义文案**：不引导 `/use <alias> 查看结果`（卡片已在时间线），文案为「已完成」/「失败」即可。
- 错误：`⚠️ <display-alias> 失败`。
- 复用 `toDisplaySessionAlias` 做显示别名转换；提醒文案在飞书侧构造（微信的 `completion-notice.ts` 文案含 `/use 查看结果`，B 语义不适用，故飞书单独构造，不复用该文件）。

### 列表 ●
- `handleSessions` 已用 `listBackgroundResultAliases` + `decorateUnread` 打 ●，飞书走同一 handler 自动生效。
- `/use` 切回触发 `takeBackgroundResult` 清除信号（B 语义下只清除、不追加 text）。

## 7. 错误处理

- 后台 turn 抛错 → 卡片 `fail()` 定格（飞书现有逻辑）+ `setBackgroundResult(..., { status: "error", finished_at, text: "" })` + 发 `⚠️ <alias> 失败` 提醒。
- 守护进程重启 → `activeTurns`（内存态）丢失在飞行中的标记（与微信一致，可接受）；`background_results`（持久化）保留已完成信号。
- 卡片 seed 失败（权限 / CardKit 缺失 / 网络）→ 沿用飞书现有 fallback 到静态文字回复的逻辑；并发与会话绑定逻辑不依赖卡片是否成功 seed。

## 8. 风险与待验证假设

1. **命令路由是否经 core handler**（§4 注）：飞书 `/sessions`、`/use` 是否最终触发 core 的 `handleSessions` / `handleSessionUse`（从而自动获得 ● 与切回清除）。writing-plans 第一步需用 discovery 确认；若飞书命令不经 core handler，则需额外接线。
2. **conversation-executor 移位回归**：移动文件后 weixin 现有单测须全绿，确保 import 路径与行为不回归。
3. **dispatch-time 绑定与飞书 thread 语义**：飞书 `chatKey` 含 thread 维度（`feishu:acct:chat:thread:tid`）。`sessionKey` 用 `boundAlias`，与 thread 维度的 `conversationId` 组合需确认不串车道。
4. **并发下 Lark 限流**：多卡同时高频刷新可能触发 CardKit 速率限制；`FlushController` 现有阈值是否够，需在 smoke 阶段观察（非阻塞 MVP，但要 log）。

## 9. 测试策略

- **核心**：`conversation-executor` 移位后，跑现有 weixin 单测确保零回归（`npm run test:unit`）。
- **飞书新增单测**（`packages/channel-feishu`，`bun:test`，与现有测试风格一致）：
  1. 斜杠命令走 `control` 车道、可抢占在跑的 normal 任务。
  2. 两个不同 `boundAlias` 的 prompt 按 sessionKey 分车道、真并发（不互相阻塞）。
  3. `/cancel <alias>` 定位到正确会话的 `activeTask` 并 abort，不误伤其他会话。
  4. 后台 turn 完成 → 写 `background_results` 完成信号 + 触发提醒；`/sessions` 列表显示 ●；`/use` 切回清除信号。
- **smoke**（可选，真飞书环境）：同一聊天两会话并发各刷各卡、完成提醒、`/cancel <alias>`。

## 10. 范围边界（YAGNI）

- **不做**：前台输出闸门 / 切回回放（B 语义已排除）。
- **不做**：把元宝渠道一起改造（本 spec 只做飞书；conversation-executor 抽到核心后元宝可后续单独接入）。
- **不做**：跨聊天 / 跨账号的并发协调（车道键已含 account+chat+thread，天然隔离）。
- **不做**：完成结果的完整文本回放（B 语义下 `background_results.text` 留空，仅作完成信号）。
