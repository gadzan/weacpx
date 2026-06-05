# `/clear` 保持 agent-side native 会话 — 设计文档

- 日期：2026-06-05
- 分支：`feat/per-channel-replymode`（实现时另开分支）
- 状态：已通过 brainstorming 评审，待写实现计划

## 背景与问题

`/clear`（解析为 `session.reset`，见 `src/commands/parse-command.ts:113`）当前的行为：
读取当前逻辑会话 → 用 `buildResetTransportSessionName` 造一个全新的 transport 名
（`${workspace}:${alias}:reset-${now}`）→ `ensureTransportSession` 新建一条空会话 →
用 `attachSession` 把同名别名**重新绑定**到这条新会话 → `useSession`。

对一条 agent-side native 会话（`source: "agent-side"`、带 `agent_session_id`）执行 `/clear` 时：

1. 调用的是 `attachSession`（不带 native 元数据），`createLogicalSession` 里 `native`
   为 undefined，于是把别名覆写成 `source: undefined`、`agent_session_id: undefined`
   （`src/sessions/session-service.ts:634-655`）。结果：**清空后你不再处于 native 会话**，
   而是落到一条普通 weacpx 会话里。
2. 清空前那条旧 native 会话的底层 envelope 没有被关闭，常驻 owner 会一直挂到 TTL 到期。

用户目标：**在 agent-side native 会话里 `/clear` 之后，仍然停留在一条 agent-side native 会话里。**

## 关键事实（决定可行性）

- `acpx sessions new`（不带 `--resume`）创建的全新空会话，本身就由 agent 分配了一个
  原生 `agentSessionId`（`acpx` 源码 `src/cli/session/session-management.ts:53`，从
  `createdSession.agentSessionId` 捕获）。即「全新空会话」天然就是一条真正的 agent-side
  原生 rollout，只是 weacpx 现在没把它标成 native。
- `acpx sessions show <name>` 会把整条 `SessionRecord` 以 JSON 打印出来
  （`acpx` 源码 `src/cli/command-handlers.ts:933`），其中**包含 `agentSessionId`**。
  weacpx 的 `readSessionRecord`（`src/transport/acpx-cli/acpx-cli-transport.ts:392`）
  当前只读取 `acpxRecordId`，没读 `agentSessionId` —— 这是唯一缺的一环。
- `acpx sessions close <name>`（transport 的 `removeSession` 即调用它）只是停进程、
  标记 `closed: true`，**保留**历史文件（`acpx` 源码 `src/cli/session/session-control.ts:189`）。
  与用户选择的「仅关闭、保留历史」一致。

## 语义决定

「agent-side」标记的**重新定义**：从「来源/被挂载来的（provenance）」改为
「对应一条真实、可被 `/ssn` 发现并 resume 的 agent 原生 rollout（capability）」。
因此 `/clear` 产出的 native 会话是一条**全新空 rollout**，与清空前那条无延续关系。
（已与用户确认采用此重定义。）

## 目标行为

当被清空的当前会话 `source === "agent-side"` 时，`/clear`：

1. 新建一条全新空 transport 会话（同现状）。
2. 读回这条新会话自己的 `agentSessionId`。
3. 用 `attachNativeSession` 把别名重新绑定为 native，带上新的 `agentSessionId` →
   用户仍停在一条 agent-side native 会话里（空的，与旧的无关）。
4. 尽力关闭清空前那条旧 native 会话（best-effort）：停掉其常驻 owner，历史保留在磁盘。

普通 weacpx 会话执行 `/clear` 时**行为不变**（仍保持 weacpx，不新增 native 标记、不关旧会话）。

## 组件与改动

### 1. Transport 回读（唯一新增能力面）

在 `SessionTransport`（`src/transport/types.ts`）新增可选方法：

```ts
getAgentSessionId?(session: ResolvedSession): Promise<string | undefined>;
```

- `acpx-cli`（`src/transport/acpx-cli/acpx-cli-transport.ts`）：扩展现有的
  `readSessionRecord`，从 `acpx sessions show <name>` 的 JSON 里一并解析
  `agentSessionId`；`getAgentSessionId` 复用之并返回该字段。字段缺失时返回 `undefined`。
- `acpx-bridge`（`src/transport/acpx-bridge/acpx-bridge-transport.ts` +
  `acpx-bridge-protocol.ts` + `src/bridge/bridge-runtime.ts`）：新增 `getAgentSessionId`
  协议方法，由 `bridge-runtime` 读取记录后返回，镜像 cli 行为。

### 2. Reset 处理器（核心）

`src/commands/handlers/session-reset-handler.ts` 的 `handleSessionResetCommand`，
仅在 `session.source === "agent-side"` 时改变行为：

- 在最顶部捕获 `previous = session`（旧 native，含旧 `transportSession` 与 `agentSessionId`）。
- 在新 transport 会话 `ensureTransportSession` + `checkTransportSession` 之后：
  - `const newAgentSessionId = await context.transport.getAgentSessionId?.(resetSession);`
  - 拿到了 → `context.sessions.attachNativeSession({ alias, agent, workspace,
    transportSession, agentSessionId: newAgentSessionId, updatedAt: nowIso })`
    （替代原来的 `attachSession`）。`title` 留空。
  - 没拿到（agent 没给 id / 读取失败）→ **回退**到现有 `attachSession`（weacpx），
    并记一条 `session.reset.native_id_unavailable` 日志；`/clear` 依然成功。
- `useSession` + `refreshSessionTransportAgentCommand` 之后，best-effort 关闭旧会话：
  - 仅当 `context.transport.removeSession` 存在
    且 `context.sessions.countAliasesSharingTransport(previous.transportSession) === 0`
    （没有别的别名仍指向旧 transport）。
  - 调 `context.transport.removeSession(previous)`，try/catch 包裹，失败记
    `session.reset.close_previous_failed` 并吞掉。**绝不影响 `/clear` 的成功返回。**

需要用到的 `transport.getAgentSessionId`、`transport.removeSession`、
`sessions.attachNativeSession`、`sessions.countAliasesSharingTransport` 均已在处理器的
`context` 上可达，几乎无需新增 ops 管线。

## 数据流

```
capture previous = getCurrentSession(chatKey)        // 旧 native，含旧 transport + agentSessionId
build reset transport name `${ws}:${alias}:reset-${now}`
reserve(reset.transport) → ensure(reset) → check(reset)   // 同现状
if previous.source === "agent-side":
    newId = transport.getAgentSessionId(reset)
    if newId: attachNativeSession({..., agentSessionId: newId})
    else:     attachSession(...)            // 回退
else:
    attachSession(...)                      // 普通会话，不变
useSession(reset.alias) → refreshAgentCommand
release(reset reservation)
if previous.source === "agent-side" && removeSession 存在
   && countAliasesSharingTransport(previous.transport) === 0:
    try removeSession(previous) catch → log+swallow
return sessionResetSuccess(reset.alias)
```

## 错误处理

- agent 未返回 `agentSessionId` → 优雅回退到 weacpx `attachSession`，绝不硬失败。
- `removeSession` 抛错 → 记日志吞掉，成功提示不变。
- `ensureTransportSession` / `checkTransportSession` 失败 → 沿用现有报错渲染，不变。

## 风险

- 唯一真实依赖：agent 在**全新创建**时返回 `agentSessionId`。支持原生挂载
  （`session/resume`）的 agent —— 也就是能触发此场景的那些 —— 基本都会返回；万一不返回，
  有 weacpx 回退兜底。
- `removeSession` 操作的是旧 native envelope（`sessions close`），不删 agent rollout，
  因此旧会话历史仍在磁盘、仍可被 `/ssn` 发现与 `prune` 清理 —— 符合「仅关闭」语义。

## 测试

`tests/unit/commands/handlers/`（reset 处理器）：

- native 当前会话 + transport 返回 agentSessionId → 调用 `attachNativeSession`、带新 id、
  `source` 为 agent-side；旧 transport 被 `removeSession`。
- native 当前会话 + `getAgentSessionId` 返回 undefined → 回退 `attachSession`（weacpx），
  `/clear` 仍成功。
- 普通（weacpx）当前会话 → 行为不变（`attachSession`、不标 native、不关旧会话）。
- `removeSession` 抛错 → 仍返回成功。
- `countAliasesSharingTransport > 0` → 旧 transport **不**被关闭。

`tests/unit/transport/`（acpx-cli）：

- `getAgentSessionId` 能从 `sessions show` 的 JSON 解析出 `agentSessionId`；
  字段缺失 → 返回 `undefined`。

## 涉及文件

- `src/transport/types.ts` —— 接口新增 `getAgentSessionId?`
- `src/transport/acpx-cli/acpx-cli-transport.ts` —— 扩展 `readSessionRecord` + `getAgentSessionId`
- `src/transport/acpx-bridge/acpx-bridge-transport.ts` + `acpx-bridge-protocol.ts`
  + `src/bridge/bridge-runtime.ts` —— 镜像实现
- `src/commands/handlers/session-reset-handler.ts` —— 核心逻辑
- `tests/unit/transport/` 与 `tests/unit/commands/handlers/` —— 测试

## 非目标（YAGNI）

- 不实现「就地清空上下文但保留同一 session id」—— ACP/agent 后端无此原语。
- 不做 `prune --include-history` 式的历史删除（用户选择仅关闭、保留历史）。
- 不改变普通 weacpx 会话的 `/clear` 行为。
- 不新增配置开关；行为对 native 会话默认开启、best-effort。
