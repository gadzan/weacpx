# `src/control` 模块说明（Control API）

`ControlService` 是面向结构化消费者（首个是 relay 连接器，见
[docs/superpowers/specs/2026-06-13-relay-hub-design.md](superpowers/specs/2026-06-13-relay-hub-design.md)）的核心控制门面。
它聚合了 `SessionService` / `ActiveTurnRegistry` / `ScheduledTaskService` /
`OrchestrationService` / `ConsoleAgent`（ChatAgent），自身无持久状态——仅在内存里
跟踪 in-flight turn（通过私有 `Map<string, AbortController>`）。

## 文件

- **`src/control/control-service.ts`** — 门面主体：sessions / scheduler /
  orchestration / prompt / executeCommand。导出类型：`ControlServiceDeps`、
  `ControlSessionInfo`、`ControlPromptInput`、`ControlPromptResult`、
  `ControlExecuteCommandInput`。
- **`src/control/control-event-bus.ts`** — `ControlEventBus` 接口与
  `createControlEventBus` 工厂：支持 `turn-output` / `turn-finished` /
  `sessions-changed` / `scheduled-changed` / `orchestration-changed` 五类事件；
  监听器异常彼此隔离（经注入的 `logger.error` 记录，不外抛）。

## 方法概览

| 方法 | 说明 |
|------|------|
| `listSessions()` | 返回所有已解析逻辑会话的快照（`ControlSessionInfo[]`），含 `running` 字段（来自 `ActiveTurnRegistry`）。 |
| `createSession(alias, agent, workspace)` | 创建逻辑会话，发出 `sessions-changed` 事件。 |
| `removeSession(alias)` | 删除逻辑会话，发出 `sessions-changed` 事件；返回 `{ wasActive: boolean }`。 |
| `listScheduledTasks(chatKey)` | 返回指定 chatKey 下的待执行定时任务列表。 |
| `createScheduledTask(input)` | 创建定时任务，发出 `scheduled-changed` 事件。 |
| `cancelScheduledTask(id, chatKey)` | 取消定时任务；取消成功时发出 `scheduled-changed` 事件；返回是否成功取消。 |
| `listOrchestrationTasks(filter?)` | 列出编排任务，支持可选过滤器。 |
| `getOrchestrationTask(taskId)` | 按 taskId 获取单个编排任务（可能为 null）。 |
| `cancelOrchestrationTask(input)` | 请求取消编排任务，发出 `orchestration-changed` 事件。 |
| `prompt(input)` | 向 agent 发起一轮对话（见下方语义要点），返回 `ControlPromptResult`。 |
| `cancelTurn(chatKey, sessionAlias)` | 通过 `AbortController` 中止进行中的 turn；返回是否成功中止。 |
| `executeCommand(input)` | 不切换会话、不发事件地向 agent 执行一条命令，收集所有分片与最终文本（换行拼接）后返回字符串。 |
| `get events()` | 返回注入的 `ControlEventBus` 实例，供消费者订阅事件。 |

## 注入方式

`buildApp`（`src/main.ts`）在组装 `AppRuntime` 时构造 `ControlService`，挂在
`AppRuntime.control`。`run-console.ts` 在调用 `channels.startAll()` 时，将
`runtime.control` 作为 `ChannelStartInput.control`（`src/channels/types.ts` 中的
可选字段）传给所有频道；纯文本频道可忽略该字段。

插件包经 `xacpx/plugin-api` 取得以下类型（仅类型，不含实例）：
`ControlService`、`ControlSessionInfo`、`ControlPromptInput`、
`ControlPromptResult`、`ControlExecuteCommandInput`、`ControlEvent`、
`ControlEventBus`、`ControlEventListener`。

## 语义要点

### prompt 并发保护

`prompt` 在注册 in-flight 条目之后才调用 `useSession(chatKey, alias)` 绑定当前会话。
同一 `(chatKey, sessionAlias)` 组合同时只允许一个 in-flight turn——若 key 已存在则立即返回
`{ ok: false, errorMessage: "turn-already-running" }`，不走 agent。
这一顺序（先写注册，再调 useSession）刻意闭合了并发竞态窗口。
`cancelTurn` 通过已保存的 `AbortController.abort()` 中止 turn。

### turn-output 与 turn-finished 事件

`prompt` 执行期间，每个流式分片都以 `turn-output`（含 `chunk` 字段）事件发出；
agent 返回的最终文本（`response.text`）也以同一事件再发一次。
turn 结束时无论成功或失败都发出 `turn-finished`（失败时含 `errorMessage`）。

### metadata 约定

`prompt` 和 `executeCommand` 的 metadata 固定为：
- `channel: "control"`
- `chatType: "direct"`
- `senderId`：由调用方通过输入字段提供
- `isOwner`：由调用方提供；若省略（`undefined`），则从 metadata 中完全省略该字段，
  满足核心 fail-closed 路由契约（`isOwner` 缺失 ≠ `isOwner: false`）。

### executeCommand 与 prompt 的区别

`executeCommand` 不注册 in-flight turn、不调用 `useSession`、不发出任何事件，
直接将 reply 分片与最终文本以换行连接后返回字符串。适用于不需要会话状态切换和事件流的
一次性命令执行场景。

### 事件总线覆盖范围

事件总线只保证「`ControlService` 自身发起的变更」会发事件；其它入口
（如微信频道命令）造成的变更暂不发事件，消费者如需全局快照应主动拉取。

## 关联包

- **`packages/relay-protocol`** — relay 线协议（信封 + wire DTO），零依赖、
  不 import xacpx；core↔wire 的映射放在阶段二的连接器里。
