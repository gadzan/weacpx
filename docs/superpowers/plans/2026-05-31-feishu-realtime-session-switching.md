# 飞书频道实时会话切换 + 后台并发执行 实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.
>
> **Dispatch note for THIS repo:** an RTK shell hook garbles `grep`/`cat`/`sed`/`head` output and sometimes the Read tool (injects fake placeholder lines / a stray trailing ```` ``` ````). When a read looks like a stub or has a suspicious trailing fence, re-read with `command cat <file>` (sandbox disabled) or `python3 -c "print(open('FILE',encoding='utf-8').read())"`. Verify git state via `git --no-pager …`. Each task: `git add` ONLY the named files, never `git add -A`, never touch `bun.lock`/`package.json` (except the ONE task that intentionally edits `src/plugin-api.ts`'s sibling build — see Task 3) / `.gitignore`.

**Goal:** 把微信渠道的「实时会话切换 + 后台执行」能力移植到飞书插件，采用 B 卡片语义（后台卡片就地流式跑完、切回不回放）+ A 真并发（每会话车道），修复「任务执行中 `/ss` 切换不立即生效」的 bug。

**Architecture:** 三段式。(1) 把通用的 `conversation-executor`（per-session 并发车道 + control 抢占）从 weixin 目录移到中立的 `src/runtime/`，新增一个 channel-agnostic 的 `resolveTurnLane(text)` 助手，并把这些 + `ActiveTurnRegistry`/`BackgroundResult`/`toDisplaySessionAlias` 经 `src/plugin-api.ts` 运行时导出（飞书只能经 `weacpx/plugin-api` 的已构建 `dist/` 引用核心）。(2) 飞书 `start()` 读取已存在的 `input.sessions` / `input.activeTurns`。(3) 飞书入站管线用共享 executor 取代 `chat-queue.ts` 的串行队列：斜杠开关命令走 control 车道立即抢占，prompt 按 dispatch-time `boundAlias` 分会话车道并发；turn 结束时若该会话已非前台则写「完成信号」+ 发完成提醒。

**Tech Stack:** TypeScript（ESM，src 内 import 带 `.js` 后缀），Bun，`bun:test`。核心单测：`node ./scripts/run-tests.mjs tests/unit`。单个测试文件：`bun test <path>`（`run-tests.mjs` 对单文件参数会报 ENOTDIR，是 runner 怪癖，不是测试失败）。Typecheck：`npx tsc --noEmit`。构建核心 + 插件：`bun run build`。**全量单测 GREEN 的判据是零 `(fail)` 断言行**；`cli.test.ts` 的 doctor 探针（`FAIL Config/acpx/Bridge`）是预存在的环境检查，**忽略**。

---

## 关键事实（discovery 已验证，2026-05-31）

这些事实决定了计划形状，实现时直接采用、无需重新求证：

1. **飞书命令已经走核心 handler。** 飞书 `runTurn` 调 `this.agent.chat({...})` → `ConsoleAgent.chat`（`src/console-agent.ts:12`）→ `CommandRouter.handle`（核心单例，`src/main.ts` 构造，已收 `activeTurns` 实参）→ `case "sessions"` / `"session.use"` / `"cancel"` → 核心 `handleSessions` / `handleSessionUse` / `handleCancel`。**因此 `/sessions` 的 `●` 标记、`/use` 切回的 `takeBackgroundResult` 清除、`/cancel <alias>` 的会话定位（P2 已实现）全部自动生效，无需新增命令接线。**
2. **`ChatRequestMetadata.boundSessionAlias` 已存在**（`src/weixin/agent/interface.ts:37`），核心 prompt handler 已消费它（`src/commands/handlers/session-handler.ts:727-728`：`metadata?.boundSessionAlias ? getResolvedSessionByInternalAlias(...) : getCurrentSession(...)`）。飞书 `agent.chat` 本就传 `metadata`，**只需把 `boundSessionAlias` 加进去**，无需改核心类型。
3. **飞书只能经 `weacpx/plugin-api`（已构建的 `dist/`）引用核心**——`node_modules/weacpx` 不是 workspace 符号链接；飞书 `tsconfig.json` 的 path 别名 `"weacpx/plugin-api": ["dist/plugin-api.d.ts"]` 指向构建产物，运行时经核心 `package.json` 的 `exports["./plugin-api"]` → `dist/plugin-api.js`。**所以任何飞书要用的核心符号必须先从 `src/plugin-api.ts` 运行时导出、再 `bun run build` 重建 `dist/`。**
4. **`ChannelStartInput.sessions?` 和 `.activeTurns?` 字段已存在**（`src/channels/types.ts:69,71`）。飞书 `start()` 当前没读它们——只需读取。
5. **`conversation-executor.ts` 当前仅被 `src/weixin/monitor/monitor.ts` 一处 import**（`import { createConversationExecutor } from "../messaging/conversation-executor.js";`）。移动后只需改这一处。
6. **`src/plugin-api.ts` 当前几乎全是 `export type`**（仅 3 个 `WEACPX_PLUGIN_*` 常量是运行时值导出）。`createConversationExecutor` / `resolveTurnLane` / `createActiveTurnRegistry` 是**运行时函数值**，需用 `export {...}`（不是 `export type`）。
7. **飞书单测在 `tests/unit/packages/channel-feishu/*.test.ts`**（不在包目录内），`bun:test`，相对 import `../../../../packages/channel-feishu/src/...`。
8. **weixin 的 `getWeixinMessageTurnLane`（`handle-weixin-message-turn.ts`）保持不动**——它吃 `WeixinMessage` 且含 weixin 专属的 `/jx`；新的 `resolveTurnLane(text)` 是 channel-agnostic 文本版，供飞书用。两者并存的轻微重复可接受（输入类型不同）。

---

## File Structure

**核心（src/）：**
- Create `src/runtime/conversation-executor.ts` — 从 `src/weixin/messaging/conversation-executor.ts` 移来，零逻辑改动。per-`sessionKey` 并发车道 + `control` 抢占车道。
- Create `src/runtime/turn-lane.ts` — 新增 `resolveTurnLane(text: string): "normal" | "control"`，把开关/取消命令归到 control。
- Delete `src/weixin/messaging/conversation-executor.ts`（移走后）。
- Modify `src/weixin/monitor/monitor.ts` — 改 import 路径到 `../../runtime/conversation-executor.js`。
- Modify `src/plugin-api.ts` — 运行时导出 `createConversationExecutor`/`ConversationExecutor`/`ConversationExecutorLane`、`resolveTurnLane`、`createActiveTurnRegistry`/`ActiveTurnRegistry`、`toDisplaySessionAlias`，类型导出 `BackgroundResult`、`SessionService`、`ChatRequestMetadata`。
- Test `tests/unit/runtime/conversation-executor.test.ts`（如原测试存在则一并移动）、`tests/unit/runtime/turn-lane.test.ts`（新）。

**飞书（packages/channel-feishu/src/）：**
- Modify `channel.ts` — `start()` 读 `sessions`/`activeTurns`；新增 `executor` 字段；`handleMessageEvent` 用 executor 取代 `enqueueFeishuChatTask`、算 `boundAlias`/`lane`、`markActive`；`runTurn` 收 `boundAlias`、传 `boundSessionAlias` 进 metadata、finally 里 `markInactive` + 完成信号 + 完成提醒；`ActiveTask` 加 `boundAlias` 字段；`registerActiveTask` 收 `boundAlias`。
- Create `completion-notice.ts` — `buildFeishuCompletionNotice(displayAlias, status)`（B 语义文案，不含 `/use 查看结果`）。
- Modify `chat-queue.ts` — 保留 `buildFeishuQueueKey`（仍用于 `activeTasks` 键）；移除/处理 `enqueueFeishuChatTask` 与 `clearFeishuQueueForAccount`（见 Task 6 先读调用点）。
- Test `tests/unit/packages/channel-feishu/feishu-turn-lane.test.ts`、`feishu-concurrency.test.ts`、`feishu-completion-awareness.test.ts`、`feishu-cancel-alias.test.ts`。

**文档：** `docs/commands.md`（如需补飞书实时切换说明）。

---

## Phase 1 — 核心抽离与 plugin-api 导出（独立可发版；weixin 不变）

### Task 1: 移动 conversation-executor 到中立位置

**Files:**
- Create: `src/runtime/conversation-executor.ts`
- Delete: `src/weixin/messaging/conversation-executor.ts`
- Modify: `src/weixin/monitor/monitor.ts`（import 路径）
- Move test (if exists): `tests/unit/weixin/messaging/conversation-executor.test.ts` → `tests/unit/runtime/conversation-executor.test.ts`

- [ ] **Step 1: 先确认现状**

```bash
command cat src/weixin/messaging/conversation-executor.ts
ls tests/unit/weixin/messaging/conversation-executor.test.ts 2>&1 || echo "NO_EXISTING_TEST"
command grep -rn "conversation-executor" src/ tests/ | command cat
```
预期：executor 文件存在；唯一 src import 在 `src/weixin/monitor/monitor.ts`。记下是否有现存测试。

- [ ] **Step 2: 创建新文件（内容逐字复制，零改动）**

把 `src/weixin/messaging/conversation-executor.ts` 的**完整内容**原样写入 `src/runtime/conversation-executor.ts`。完整内容如下（应与现状逐字一致；如 `command cat` 显示有差异，以仓库实际为准）：

```typescript
export type ConversationExecutorLane = "normal" | "control";

type ConversationTask<T> = () => Promise<T>;

type ConversationState = {
  normalTails: Map<string, Promise<unknown>>;
  activeControls: number;
};

const DEFAULT_SESSION_KEY = "__chat__";

export type ConversationExecutor = {
  run<T>(
    conversationId: string,
    lane: ConversationExecutorLane,
    task: ConversationTask<T>,
    sessionKey?: string,
  ): Promise<T>;
};

export function createConversationExecutor(): ConversationExecutor {
  const states = new Map<string, ConversationState>();

  const getState = (conversationId: string): ConversationState => {
    const existing = states.get(conversationId);
    if (existing) return existing;
    const created: ConversationState = { normalTails: new Map(), activeControls: 0 };
    states.set(conversationId, created);
    return created;
  };

  const cleanupState = (conversationId: string, state: ConversationState) => {
    if (state.normalTails.size === 0 && state.activeControls === 0) {
      states.delete(conversationId);
    }
  };

  return {
    run<T>(
      conversationId: string,
      lane: ConversationExecutorLane,
      task: ConversationTask<T>,
      sessionKey?: string,
    ): Promise<T> {
      const state = getState(conversationId);

      if (lane === "control") {
        state.activeControls += 1;
        return Promise.resolve()
          .then(task)
          .finally(() => {
            state.activeControls -= 1;
            cleanupState(conversationId, state);
          });
      }

      const key = sessionKey ?? DEFAULT_SESSION_KEY;
      const previous = state.normalTails.get(key) ?? Promise.resolve();
      const next: Promise<T> = previous.then(
        () => task(),
        () => task(),
      );
      state.normalTails.set(key, next);

      return next.finally(() => {
        if (state.normalTails.get(key) === next) {
          state.normalTails.delete(key);
        }
        cleanupState(conversationId, state);
      });
    },
  };
}
```

- [ ] **Step 3: 删除旧文件 + 改 import**

```bash
rm src/weixin/messaging/conversation-executor.ts
```
在 `src/weixin/monitor/monitor.ts` 把
```typescript
import { createConversationExecutor } from "../messaging/conversation-executor.js";
```
改为
```typescript
import { createConversationExecutor } from "../../runtime/conversation-executor.js";
```
（如该文件还 import 了 `ConversationExecutorLane` 等类型，一并改路径。先 `command grep -n "conversation-executor" src/weixin/monitor/monitor.ts` 确认所有 import 行。）

- [ ] **Step 4: 移动现存测试（若 Step 1 发现存在）**

若存在 `tests/unit/weixin/messaging/conversation-executor.test.ts`：
```bash
mkdir -p tests/unit/runtime
git mv tests/unit/weixin/messaging/conversation-executor.test.ts tests/unit/runtime/conversation-executor.test.ts
```
然后把该测试文件里的 import（指向 `src/weixin/messaging/conversation-executor`）改为指向 `../../../src/runtime/conversation-executor`（按测试文件实际相对深度调整；用 `command cat` 看其现有 import 行的相对前缀，保持同样层级数）。若 Step 1 发现无现存测试，跳过本步。

- [ ] **Step 5: 验证**

```bash
npx tsc --noEmit
node ./scripts/run-tests.mjs tests/unit
```
预期：tsc 干净；无新增 `(fail)` 行（忽略 cli.test.ts doctor 探针）。weixin 行为不变。

- [ ] **Step 6: Commit**

```bash
git add src/runtime/conversation-executor.ts src/weixin/monitor/monitor.ts
git add -A tests/unit/runtime/ tests/unit/weixin/messaging/ 2>/dev/null
git status --porcelain   # 确认没有意外文件
git commit -m "refactor(runtime): move conversation-executor to neutral src/runtime"
```
（注意：`git add -A tests/...` 仅限这两个测试目录，用于捕获 `git mv` 与删除；commit 前用 `git status --porcelain` 核对没有别的文件被加入。）

---

### Task 2: 新增 channel-agnostic 的 resolveTurnLane

**Files:**
- Create: `src/runtime/turn-lane.ts`
- Test: `tests/unit/runtime/turn-lane.test.ts`

- [ ] **Step 1: 写失败测试**

Create `tests/unit/runtime/turn-lane.test.ts`:
```typescript
import { expect, test } from "bun:test";
import { resolveTurnLane } from "../../../src/runtime/turn-lane";

test("/ss switch goes to control lane", () => {
  expect(resolveTurnLane("/ss backend")).toBe("control");
});

test("/use switch goes to control lane", () => {
  expect(resolveTurnLane("/use backend")).toBe("control");
});

test("/cancel goes to control lane", () => {
  expect(resolveTurnLane("/cancel")).toBe("control");
});

test("/stop goes to control lane", () => {
  expect(resolveTurnLane("/stop backend")).toBe("control");
});

test("/ssn (native session list) stays normal — it can be slow", () => {
  expect(resolveTurnLane("/ssn codex")).toBe("normal");
});

test("a plain prompt stays normal", () => {
  expect(resolveTurnLane("帮我重构这个函数")).toBe("normal");
});

test("leading whitespace is tolerated", () => {
  expect(resolveTurnLane("  /ss backend")).toBe("control");
});
```

- [ ] **Step 2: 跑测试确认失败**

```bash
bun test tests/unit/runtime/turn-lane.test.ts
```
预期：FAIL —— `resolveTurnLane` 未导出。

- [ ] **Step 3: 实现**

Create `src/runtime/turn-lane.ts`:
```typescript
import type { ConversationExecutorLane } from "./conversation-executor.js";

// Channel-agnostic lane classifier. Switch/cancel commands must PREEMPT an
// in-flight prompt so the user can change the foreground session in real time;
// they only touch chat-context state and never run a long task, so the control
// lane is safe. Everything else — including `/ssn` (native session discovery,
// which can be slow) and normal prompts — runs on the per-session normal lane.
//
// NOTE: weixin keeps its own `getWeixinMessageTurnLane` (it consumes a
// WeixinMessage and additionally routes the weixin-only `/jx` no-op). This
// text-based helper is the version non-weixin channels use.
const CONTROL_COMMANDS = new Set(["/use", "/ss", "/cancel", "/stop"]);

export function resolveTurnLane(text: string): ConversationExecutorLane {
  const command = text.trim().toLowerCase().split(/\s+/)[0] ?? "";
  return CONTROL_COMMANDS.has(command) ? "control" : "normal";
}
```

- [ ] **Step 4: 跑测试确认通过**

```bash
bun test tests/unit/runtime/turn-lane.test.ts
```
预期：PASS（7/7）。

- [ ] **Step 5: Commit**

```bash
git add src/runtime/turn-lane.ts tests/unit/runtime/turn-lane.test.ts
git commit -m "feat(runtime): add channel-agnostic resolveTurnLane helper"
```

---

### Task 3: 经 plugin-api 运行时导出，重建 dist

**Files:**
- Modify: `src/plugin-api.ts`
- （构建产物 `dist/plugin-api.{js,d.ts}` 由 `bun run build` 生成，不手改、不提交——`dist/` 已被 gitignore，构建只是为让飞书 tsc 能解析）

- [ ] **Step 1: 确认当前 plugin-api 内容与 toDisplaySessionAlias 位置**

```bash
command cat src/plugin-api.ts
command grep -rn "export function toDisplaySessionAlias\|export const toDisplaySessionAlias" src/channels/channel-scope.ts | command cat
command grep -rn "export interface BackgroundResult\|export type BackgroundResult" src/state/types.ts | command cat
command grep -rn "export class SessionService\|export interface SessionService" src/sessions/session-service.ts | command cat
```
确认：`toDisplaySessionAlias` 在 `src/channels/channel-scope.ts`；`BackgroundResult` 在 `src/state/types.ts`；`SessionService` 是 class（`src/sessions/session-service.ts`）；`ChatRequestMetadata` 在 `src/weixin/agent/interface.ts`。

- [ ] **Step 2: 追加导出**

在 `src/plugin-api.ts` 末尾追加（**运行时值用 `export {}`，类型用 `export type {}`**）：
```typescript
// Realtime session switching + per-session concurrency primitives, shared with
// channel plugins (feishu, yuanbao, …) that re-implement their own dispatch/
// output layer but reuse core lane scheduling + session state.
export { createConversationExecutor } from "./runtime/conversation-executor.js";
export type { ConversationExecutor, ConversationExecutorLane } from "./runtime/conversation-executor.js";
export { resolveTurnLane } from "./runtime/turn-lane.js";
export { createActiveTurnRegistry } from "./sessions/active-turn-registry.js";
export type { ActiveTurnRegistry } from "./sessions/active-turn-registry.js";
export { toDisplaySessionAlias } from "./channels/channel-scope.js";
export type { SessionService } from "./sessions/session-service.js";
export type { BackgroundResult } from "./state/types.js";
export type { ChatRequestMetadata } from "./weixin/agent/interface.js";
```
> 若 `toDisplaySessionAlias` 实际不在 `channel-scope.ts`，用 Step 1 grep 出的真实路径。`SessionService` 若导出为 class，`export type { SessionService }` 仍可（飞书只用其类型）。

- [ ] **Step 3: typecheck + 构建核心**

```bash
npx tsc --noEmit
bun run build
```
预期：tsc 干净；build 成功（输出 `cli.js` / `bridge/bridge-main.js` / `plugin-api.js`）。

- [ ] **Step 4: 验证 dist 含新运行时符号**

```bash
command grep -c "createConversationExecutor\|resolveTurnLane\|createActiveTurnRegistry\|toDisplaySessionAlias" dist/plugin-api.js
command grep -c "ConversationExecutor\|ActiveTurnRegistry\|BackgroundResult\|ChatRequestMetadata" dist/plugin-api.d.ts
```
预期：两条都 > 0（运行时符号在 `.js`，类型在 `.d.ts`）。若为 0，说明导出未生效，回查 Step 2。

- [ ] **Step 5: Commit（只提交源文件，不提交 dist）**

```bash
git add src/plugin-api.ts
git status --porcelain   # 确认 dist/ 未被加入（应已被 .gitignore）
git commit -m "feat(plugin-api): export conversation-executor, turn-lane, active-turn-registry for channel plugins"
```

---

## Phase 2 — 飞书 start() 接上 core 服务

### Task 4: 飞书读取并保存 sessions / activeTurns / executor

**Files:**
- Modify: `packages/channel-feishu/src/channel.ts`（class 字段 + `start()`）
- Test: `tests/unit/packages/channel-feishu/feishu-start-wiring.test.ts`

- [ ] **Step 1: 先读现状**

```bash
command cat packages/channel-feishu/src/channel.ts | python3 -c "import sys;d=sys.stdin.read();print(d[:4000])"
```
确认 class 字段块（当前有 `agent`/`quota`/`logger`/`activeTasks`，**无** `sessions`/`activeTurns`/`executor`）与 `start(input)` 体（当前只赋 `agent`/`quota`/`logger`）。确认顶部已 `import type { ChannelStartInput } from "weacpx/plugin-api";`。

- [ ] **Step 2: 写失败测试**

Create `tests/unit/packages/channel-feishu/feishu-start-wiring.test.ts`。先 `command cat` 一个现有飞书测试（如 `tests/unit/packages/channel-feishu/feishu-channel.test.ts`）借用它构造 channel + noop logger/quota 的写法。测试断言：`start()` 后，传入的 `sessions` 与 `activeTurns` 被频道保存（通过一个可观测副作用验证——见下）。最小可行写法：
```typescript
import { expect, test } from "bun:test";
import { FeishuChannel } from "../../../../packages/channel-feishu/src/channel";
// 复用现有测试里的 createNoopLogger / createNoopQuota / 构造 FeishuChannel 的工厂；
// 若现有测试未导出它们，在本文件内按同样形态内联（参照 feishu-channel.test.ts）。

test("start() captures sessions and activeTurns from ChannelStartInput", async () => {
  let peeked: string | undefined = "sentinel";
  const sessions = {
    peekCurrentSessionAlias: (_chatKey: string) => { peeked = "called"; return undefined; },
  } as any;
  const activeTurns = { markActive() {}, markInactive() {}, isActive: () => false } as any;

  const channel = makeFeishuChannelForTest(); // 工厂：禁用真实 WS（deps.createClient 返回 stub，startWS noop）
  await channel.start({
    agent: { chat: async () => ({ text: "" }) } as any,
    abortSignal: new AbortController().signal,
    quota: createNoopQuota(),
    logger: createNoopLogger(),
    sessions,
    activeTurns,
  } as any);

  // 频道应已保存 sessions：用一个内部可观测入口验证。最稳妥的断言是
  // 调用频道暴露给测试的 getter，或断言 start() 不抛错且后续 dispatch 能用到
  // sessions。这里先断言 start 完成、字段非空（通过 (channel as any)）。
  expect((channel as any).sessions).toBe(sessions);
  expect((channel as any).activeTurns).toBe(activeTurns);
});
```
> 注：`makeFeishuChannelForTest` 需让 `start()` 不连真实飞书——参照现有 `feishu-channel.test.ts` 如何注入 `deps.createClient` 返回带 noop `probeBot`/`startWS` 的 stub client，且账号配置 `eligible` 至少一个或为空（空账号时 `start()` 直接 `Promise.all([])` 完成，最简）。优先用「零 eligible 账号」让 `start()` 走最短路径。

- [ ] **Step 3: 跑测试确认失败**

```bash
bun test tests/unit/packages/channel-feishu/feishu-start-wiring.test.ts
```
预期：FAIL —— `(channel as any).sessions` 为 undefined（字段未保存）。

- [ ] **Step 4: 实现**

在 `channel.ts` 顶部 import 增加（与现有 `weacpx/plugin-api` import 合并）：
```typescript
import {
  createConversationExecutor,
  resolveTurnLane,
  toDisplaySessionAlias,
} from "weacpx/plugin-api";
import type {
  ChannelStartInput,
  ConversationExecutor,
  SessionService,
  ActiveTurnRegistry,
  // …保留现有 type import：CoordinatorMessageInput, CreateChannelDeps, ScheduledChannelMessageInput, MessageChannelRuntime, OrchestrationDeliveryCallbacks
} from "weacpx/plugin-api";
```
> `createConversationExecutor`/`resolveTurnLane`/`toDisplaySessionAlias` 是运行时值（普通 import）；其余是 type-only。把它们正确分到 `import {}` 与 `import type {}`。

在 class 字段块加：
```typescript
  private sessions: SessionService | null = null;
  private activeTurns: ActiveTurnRegistry | null = null;
  private readonly executor: ConversationExecutor = createConversationExecutor();
```

在 `start(input)` 体里（紧随现有 `this.agent = input.agent;` 等赋值之后）加：
```typescript
    this.sessions = input.sessions ?? null;
    this.activeTurns = input.activeTurns ?? null;
```

- [ ] **Step 5: 跑测试确认通过 + typecheck**

```bash
bun test tests/unit/packages/channel-feishu/feishu-start-wiring.test.ts
npx tsc --noEmit
```
预期：PASS；tsc 干净（飞书 tsc 经 `bun run build:channel-feishu` 链，但 `npx tsc --noEmit` 走根 tsconfig，应能解析新 `weacpx/plugin-api` 符号，因 Task 3 已重建 `dist/plugin-api.d.ts`）。若飞书包有独立 typecheck：`cd packages/channel-feishu && npx tsc --noEmit -p tsconfig.json`（用 `command cat packages/channel-feishu/package.json` 看脚本）。

- [ ] **Step 6: Commit**

```bash
git add packages/channel-feishu/src/channel.ts tests/unit/packages/channel-feishu/feishu-start-wiring.test.ts
git commit -m "feat(feishu): capture sessions/activeTurns and create conversation executor in start()"
```

---

## Phase 3 — 飞书入站管线改造（control 抢占 + 每会话车道）

### Task 5: ActiveTask 加 boundAlias，registerActiveTask 透传

**Files:**
- Modify: `packages/channel-feishu/src/channel.ts`（`ActiveTask` 接口 + `registerActiveTask`）
- Test: `tests/unit/packages/channel-feishu/feishu-cancel-alias.test.ts`（先建空壳，本任务仅加一条字段存在性断言；Task 8 再补全）

- [ ] **Step 1: 写失败测试（字段透传）**

Create `tests/unit/packages/channel-feishu/feishu-cancel-alias.test.ts`：
```typescript
import { expect, test } from "bun:test";
import { FeishuChannel } from "../../../../packages/channel-feishu/src/channel";

test("registerActiveTask records the bound session alias on the task", () => {
  const channel = makeFeishuChannelForTest();
  const { active } = (channel as any).registerActiveTask({
    accountId: "a", chatId: "c", messageId: "m", queueKey: "a:c",
    senderOpenId: "ou_1", chatType: "p2p", boundAlias: "feishu:a:c:codex",
  });
  expect(active.boundAlias).toBe("feishu:a:c:codex");
});
```
> `makeFeishuChannelForTest` 同 Task 4（零 eligible 账号即可，本测试只调 `registerActiveTask`，不需要 `start()`）。

- [ ] **Step 2: 跑测试确认失败**

```bash
bun test tests/unit/packages/channel-feishu/feishu-cancel-alias.test.ts
```
预期：FAIL —— `boundAlias` 未被记录（或 `registerActiveTask` 不接受该入参）。

- [ ] **Step 3: 实现**

在 `ActiveTask` 接口加字段（紧随 `chatType` 后）：
```typescript
  // INTERNAL session alias this turn was bound to at dispatch time (undefined
  // for slash commands / when sessions service is unavailable). Used to target
  // `/cancel <alias>` at the right in-flight turn and to record completion.
  boundAlias: string | undefined;
```
`registerActiveTask` 入参类型加 `boundAlias: string | undefined;`，构造 `active` 时加 `boundAlias: input.boundAlias,`：
```typescript
  private registerActiveTask(input: {
    accountId: string;
    chatId: string;
    messageId: string;
    queueKey: string;
    senderOpenId: string | undefined;
    chatType: string | undefined;
    boundAlias: string | undefined;
  }): { active: ActiveTask; abortController: AbortController } {
    const { accountId, chatId, messageId, queueKey, senderOpenId, chatType, boundAlias } = input;
    const abortController = new AbortController();
    const active: ActiveTask = {
      accountId,
      chatId,
      messageId,
      senderOpenId,
      chatType,
      boundAlias,
      typingState: { messageId, reactionId: null },
      abortController,
      suppressed: false,
      cardController: null,
    };
    const stack = this.activeTasks.get(queueKey) ?? [];
    stack.push(active);
    this.activeTasks.set(queueKey, stack);
    return { active, abortController };
  }
```

- [ ] **Step 4: 跑测试确认通过 + typecheck**

```bash
bun test tests/unit/packages/channel-feishu/feishu-cancel-alias.test.ts
npx tsc --noEmit
```
预期：PASS；tsc 干净（注意：所有现存调用 `registerActiveTask` 的地方现在必须传 `boundAlias`——下一个 Task 6 会改 `handleMessageEvent` 的调用点。如果本 Task 后 tsc 因 `handleMessageEvent` 未传 `boundAlias` 报错，临时在该调用点传 `boundAlias: undefined` 占位，Task 6 再正式赋值）。为避免 tsc 红，在本 Task 的实现里**同时**把 `handleMessageEvent` 里现有的 `registerActiveTask({...})` 调用补上 `boundAlias: undefined,`（仅占位，Task 6 替换）。

- [ ] **Step 5: Commit**

```bash
git add packages/channel-feishu/src/channel.ts tests/unit/packages/channel-feishu/feishu-cancel-alias.test.ts
git commit -m "feat(feishu): record bound session alias on ActiveTask"
```

---

### Task 6: 用 conversation-executor 取代串行队列 + dispatch-time 绑定

**Files:**
- Modify: `packages/channel-feishu/src/channel.ts`（`handleMessageEvent`、`runTurn` 签名与 metadata）
- Modify: `packages/channel-feishu/src/chat-queue.ts`（处理 `enqueueFeishuChatTask`/`clearFeishuQueueForAccount` 去留）
- Test: `tests/unit/packages/channel-feishu/feishu-concurrency.test.ts`

- [ ] **Step 1: 先读 chat-queue 调用点与 clearFeishuQueueForAccount 用法**

```bash
command grep -rn "enqueueFeishuChatTask\|clearFeishuQueueForAccount\|buildFeishuQueueKey\|resetFeishuChatQueueForTests" packages/channel-feishu/src/ tests/ | command cat
```
记录：`clearFeishuQueueForAccount` 在 `channel.ts` 的调用点（多半在 `stop()`/账号清理）。`buildFeishuQueueKey` 仍用于 `activeTasks` 键——**保留**。`resetFeishuChatQueueForTests` 仅测试用。

- [ ] **Step 2: 写失败测试（真并发 + control 抢占）**

Create `tests/unit/packages/channel-feishu/feishu-concurrency.test.ts`。测试目标：两个不同 `boundAlias` 的 prompt 任务经 `this.executor` 并发（不互相阻塞）；control 命令立即执行不被在跑 normal 任务阻塞。鉴于驱动整个 `handleMessageEvent` 较重，**直接测 executor 行为契约**（executor 已有自己的单测，但这里测「飞书按 lane/sessionKey 正确调度」的接线）。最稳的单元做法：暴露一个测试可调的薄封装，或直接断言 `resolveTurnLane` + executor 组合。推荐如下，用一个受控 executor 探针验证 `handleMessageEvent` 传给 executor 的 `(lane, sessionKey)`：

```typescript
import { expect, test } from "bun:test";
import { FeishuChannel } from "../../../../packages/channel-feishu/src/channel";

test("prompt dispatches on normal lane keyed by bound session alias", async () => {
  const calls: Array<{ lane: string; sessionKey: string | undefined }> = [];
  const channel = makeFeishuChannelForTest();
  // 用受控 executor 替换频道的 executor（测试注入）：
  (channel as any).executor = {
    run: (_convId: string, lane: string, task: () => Promise<unknown>, sessionKey?: string) => {
      calls.push({ lane, sessionKey });
      return Promise.resolve().then(task);
    },
  };
  (channel as any).sessions = { peekCurrentSessionAlias: () => "feishu:a:c:codex" };
  (channel as any).activeTurns = { markActive() {}, markInactive() {}, isActive: () => false };
  (channel as any).agent = { chat: async () => ({ text: "ok" }) };
  (channel as any).quota = createNoopQuota();
  (channel as any).logger = createNoopLogger();

  await (channel as any).handleMessageEvent("a", makeTextEvent({ chatId: "c", text: "帮我跑个任务" }));

  expect(calls).toHaveLength(1);
  expect(calls[0]).toEqual({ lane: "normal", sessionKey: "feishu:a:c:codex" });
});

test("a switch command dispatches on the control lane", async () => {
  const calls: Array<{ lane: string; sessionKey: string | undefined }> = [];
  const channel = makeFeishuChannelForTest();
  (channel as any).executor = {
    run: (_c: string, lane: string, task: () => Promise<unknown>, sessionKey?: string) => {
      calls.push({ lane, sessionKey });
      return Promise.resolve().then(task);
    },
  };
  (channel as any).sessions = { peekCurrentSessionAlias: () => "feishu:a:c:codex" };
  (channel as any).activeTurns = { markActive() {}, markInactive() {}, isActive: () => false };
  (channel as any).agent = { chat: async () => ({ text: "switched" }) };
  (channel as any).quota = createNoopQuota();
  (channel as any).logger = createNoopLogger();

  await (channel as any).handleMessageEvent("a", makeTextEvent({ chatId: "c", text: "/ss backend" }));

  expect(calls[0]?.lane).toBe("control");
});
```
> `makeTextEvent` 构造一个最小 `FeishuMessageEvent`（参照现有 `feishu-inbound.test.ts` 的 `event()` helper：`message_type:"text"`, `content: JSON.stringify({text})`, 有效 `create_time`, `chat_type:"p2p"`, sender open_id）。`makeFeishuChannelForTest` 同前。这两个测试绕过真实 dedup/下载——若 `handleMessageEvent` 因 dedup/policy 提前 return，需在事件里给唯一 `message_id` 并确保 p2p 默认放行（参照现有测试）。

- [ ] **Step 3: 跑测试确认失败**

```bash
bun test tests/unit/packages/channel-feishu/feishu-concurrency.test.ts
```
预期：FAIL —— 当前 `handleMessageEvent` 用 `enqueueFeishuChatTask`，未调用注入的 `executor`，`calls` 为空。

- [ ] **Step 4: 改 handleMessageEvent**

把 `handleMessageEvent` 末尾（从 `const { active, abortController } = this.registerActiveTask({...})` 到 `await run.promise;`）替换为：
```typescript
    const isSlash = requestText.trim().startsWith("/");
    const boundAlias = isSlash ? undefined : this.sessions?.peekCurrentSessionAlias(chatKey);
    const lane = resolveTurnLane(requestText);

    const { active, abortController } = this.registerActiveTask({
      accountId,
      chatId,
      messageId,
      queueKey,
      senderOpenId: event.sender?.sender_id?.open_id,
      chatType: event.message.chat_type,
      boundAlias,
    });

    if (boundAlias) this.activeTurns?.markActive(chatKey, boundAlias);

    await this.executor.run(
      chatKey,
      lane,
      () => this.runTurn({
        runtime,
        accountId,
        chatId,
        chatType: event.message.chat_type,
        chatKey,
        queueKey,
        messageId,
        requestText,
        media,
        active,
        abortController,
        boundAlias,
      }),
      boundAlias,
    );
```
> `this.executor.run(conversationId, lane, task, sessionKey)`：`conversationId` 用 `chatKey`，`sessionKey` 用 `boundAlias`（undefined 时 executor 落到 `DEFAULT_SESSION_KEY`，即斜杠命令/无 sessions 时共享 chat 级车道）。移除 `enqueueFeishuChatTask` import 与调用。

- [ ] **Step 5: 改 runTurn 签名 + metadata**

`runTurn` 入参类型加 `boundAlias: string | undefined;`，解构加 `boundAlias`。把 `agent.chat` 调用里的 `metadata`：
```typescript
        metadata: buildFeishuRouteMetadata({ chatType, senderOpenId: active.senderOpenId, chatId }),
```
改为合并 `boundSessionAlias`（仅在有 boundAlias 时加）：
```typescript
        metadata: {
          ...buildFeishuRouteMetadata({ chatType, senderOpenId: active.senderOpenId, chatId }),
          ...(boundAlias ? { boundSessionAlias: boundAlias } : {}),
        },
```
> `buildFeishuRouteMetadata` 返回对象会被核心 `CommandRouter` 当 `ChatRequestMetadata` 用；加 `boundSessionAlias` 字段后核心 prompt handler 会据它 `getResolvedSessionByInternalAlias`（关键事实 #2）。`activeTurns.markInactive` 与完成信号在 Task 7 加入 `runTurn` 的 finally；本 Task 暂不动 finally。

- [ ] **Step 6: 处理 chat-queue.ts**

按 Step 1 的发现：
- 移除 `channel.ts` 对 `enqueueFeishuChatTask` 的 import。
- 保留 `buildFeishuQueueKey` import（`activeTasks` 仍用）。
- `clearFeishuQueueForAccount`：若 Step 1 发现 `channel.ts` 在 `stop()`/账号清理调用它——executor 无「按账号清空」语义，但其 state 在任务 settle 后自动 `cleanupState`，且 `abortSignal` 关停时会中止在跑 `agent.chat`。把该调用**移除**（executor 自管生命周期），并在 `chat-queue.ts` 保留该函数（不删文件，避免影响其它 import / 测试），但若它现在已无生产调用，标注为仅测试遗留。`enqueueFeishuChatTask` 暂保留在 `chat-queue.ts`（现有单测 `feishu-inbound.test.ts` 仍 import 它；删它会破测试）。
> **不要删除 `chat-queue.ts` 或其导出函数**——它们仍被现有测试引用。只是 `channel.ts` 的 dispatch 不再用 `enqueueFeishuChatTask`。

- [ ] **Step 7: 跑测试 + 全量 + typecheck**

```bash
bun test tests/unit/packages/channel-feishu/feishu-concurrency.test.ts
node ./scripts/run-tests.mjs tests/unit
npx tsc --noEmit
```
预期：并发测试 PASS；全量无新增 `(fail)`（现有飞书测试如断言串行行为可能需更新——若某测试因 dispatch 从队列改 executor 而失败，按新语义更新该断言，并在 commit message 注明）；tsc 干净。

- [ ] **Step 8: Commit**

```bash
git add packages/channel-feishu/src/channel.ts packages/channel-feishu/src/chat-queue.ts tests/unit/packages/channel-feishu/feishu-concurrency.test.ts
# 若更新了现有飞书测试，一并 git add 那些文件（逐一列名，勿 git add -A）
git commit -m "feat(feishu): per-session concurrent lanes + control-lane preemption for switch commands"
```

---

## Phase 4 — 完成感知（完成信号 + 提醒 + 列表●）

### Task 7: turn 结束写后台完成信号并发提醒

**Files:**
- Create: `packages/channel-feishu/src/completion-notice.ts`
- Modify: `packages/channel-feishu/src/channel.ts`（`runTurn` 的 `finally` + 新增发送助手）
- Test: `tests/unit/packages/channel-feishu/feishu-completion-notice.test.ts`、`tests/unit/packages/channel-feishu/feishu-completion-awareness.test.ts`

- [ ] **Step 1: 写完成提醒文案的失败测试**

Create `tests/unit/packages/channel-feishu/feishu-completion-notice.test.ts`:
```typescript
import { expect, test } from "bun:test";
import { buildFeishuCompletionNotice } from "../../../../packages/channel-feishu/src/completion-notice";

test("done notice names the session, no /use guidance (card already in timeline)", () => {
  expect(buildFeishuCompletionNotice("backend", "done")).toBe("✅ backend 已完成");
});

test("error notice", () => {
  expect(buildFeishuCompletionNotice("backend", "error")).toBe("⚠️ backend 失败");
});
```

- [ ] **Step 2: 跑测试确认失败**

```bash
bun test tests/unit/packages/channel-feishu/feishu-completion-notice.test.ts
```
预期：FAIL —— 模块不存在。

- [ ] **Step 3: 实现文案助手**

Create `packages/channel-feishu/src/completion-notice.ts`:
```typescript
// B-semantics completion ping: the backgrounded session's card already streamed
// to completion in the chat timeline, so this short notice only signals "it's
// done" — it does NOT tell the user to /use to view results (unlike the weixin
// variant, where the result is replayed on switch-back).
export function buildFeishuCompletionNotice(displayAlias: string, status: "done" | "error"): string {
  return status === "done" ? `✅ ${displayAlias} 已完成` : `⚠️ ${displayAlias} 失败`;
}
```

- [ ] **Step 4: 跑文案测试确认通过**

```bash
bun test tests/unit/packages/channel-feishu/feishu-completion-notice.test.ts
```
预期：PASS（2/2）。

- [ ] **Step 5: 先读 runTurn 的 finally 与发送方法签名**

```bash
command grep -n "sendReplyWithGuard\|private async runTurn\|} finally {" packages/channel-feishu/src/channel.ts | command cat
python3 -c "
import re
b=open('packages/channel-feishu/src/channel.ts',encoding='utf-8').read().splitlines()
# print the sendReplyWithGuard signature region
for i,l in enumerate(b,1):
    if 'sendReplyWithGuard' in l and ('private' in l or 'async' in l):
        for j in range(i-1, min(i+8,len(b))): print(j+1, b[j])
"
```
记下 `sendReplyWithGuard` 的确切签名（入参对象字段：`runtime`、`chatId`、`replyToMessageId?`、`text`）。

- [ ] **Step 6: 写完成感知集成测试**

Create `tests/unit/packages/channel-feishu/feishu-completion-awareness.test.ts`。验证：当一个绑定到 `aliasA` 的 turn 跑完、而此时前台已切到 `aliasB`（`peekCurrentSessionAlias` 返回 `aliasB`），`runTurn` 应：① 调 `sessions.setBackgroundResult(chatKey, aliasA, {status:"done", text:"", finished_at})`；② 调 `activeTurns.markInactive(chatKey, aliasA)`；③ 发一条完成提醒。用受控 stub 注入：
```typescript
import { expect, test } from "bun:test";
import { FeishuChannel } from "../../../../packages/channel-feishu/src/channel";

test("turn that finished while backgrounded records a completion signal and pings", async () => {
  const setCalls: any[] = [];
  const inactiveCalls: any[] = [];
  const sent: string[] = [];
  const channel = makeFeishuChannelForTest();
  (channel as any).sessions = {
    peekCurrentSessionAlias: () => "feishu:a:c:other",       // 前台已切走
    setBackgroundResult: async (ck: string, alias: string, r: any) => { setCalls.push({ ck, alias, r }); },
  };
  (channel as any).activeTurns = {
    markActive() {}, isActive: () => false,
    markInactive: (ck: string, alias: string) => inactiveCalls.push({ ck, alias }),
  };
  (channel as any).agent = { chat: async () => ({ text: "done text" }) };
  (channel as any).quota = createNoopQuota();
  (channel as any).logger = createNoopLogger();
  // stub 发送：拦 sendReplyWithGuard
  (channel as any).sendReplyWithGuard = async ({ text }: { text: string }) => { sent.push(text); };
  // stub deliverResponse 以免它再发一次（静态模式下它会发最终文本）——用 noop
  (channel as any).deliverResponse = async () => {};

  const { active, abortController } = (channel as any).registerActiveTask({
    accountId: "a", chatId: "c", messageId: "m", queueKey: "a:c",
    senderOpenId: "ou", chatType: "p2p", boundAlias: "feishu:a:c:codex",
  });

  await (channel as any).runTurn({
    runtime: makeRuntimeStub(), accountId: "a", chatId: "c", chatType: "p2p",
    chatKey: "feishu:a:c", queueKey: "a:c", messageId: "m",
    requestText: "task", media: [], active, abortController,
    boundAlias: "feishu:a:c:codex",
  });

  expect(setCalls).toHaveLength(1);
  expect(setCalls[0].alias).toBe("feishu:a:c:codex");
  expect(setCalls[0].r.status).toBe("done");
  expect(setCalls[0].r.text).toBe("");
  expect(inactiveCalls).toEqual([{ ck: "feishu:a:c", alias: "feishu:a:c:codex" }]);
  expect(sent.some((t) => t.includes("已完成"))).toBe(true);
});

test("turn that finished while STILL foreground records nothing and does not ping", async () => {
  const setCalls: any[] = [];
  const sent: string[] = [];
  const channel = makeFeishuChannelForTest();
  (channel as any).sessions = {
    peekCurrentSessionAlias: () => "feishu:a:c:codex",        // 仍是前台
    setBackgroundResult: async (...a: any[]) => { setCalls.push(a); },
  };
  (channel as any).activeTurns = { markActive() {}, markInactive() {}, isActive: () => false };
  (channel as any).agent = { chat: async () => ({ text: "done" }) };
  (channel as any).quota = createNoopQuota();
  (channel as any).logger = createNoopLogger();
  (channel as any).sendReplyWithGuard = async ({ text }: { text: string }) => { sent.push(text); };
  (channel as any).deliverResponse = async () => {};

  const { active, abortController } = (channel as any).registerActiveTask({
    accountId: "a", chatId: "c", messageId: "m", queueKey: "a:c",
    senderOpenId: "ou", chatType: "p2p", boundAlias: "feishu:a:c:codex",
  });
  await (channel as any).runTurn({
    runtime: makeRuntimeStub(), accountId: "a", chatId: "c", chatType: "p2p",
    chatKey: "feishu:a:c", queueKey: "a:c", messageId: "m",
    requestText: "task", media: [], active, abortController,
    boundAlias: "feishu:a:c:codex",
  });
  expect(setCalls).toHaveLength(0);
  expect(sent.some((t) => t.includes("已完成"))).toBe(false);
});
```
> `makeRuntimeStub()` 返回 `{ account, client }`，client 的 `sdk` 带 noop `im.message.*` 与 reaction 接口（参照现有 `feishu-channel.test.ts` 的 `createFeishuTestClient`）。`addTypingIndicator`/`removeTypingIndicator`/`trySeedStreamingCard` 在静态模式（account.replyMode 非 streaming）下走最简路径——把测试账号设为非 streaming 以免 seed 真卡。若这些调用在 stub client 下抛错，给 client 补 noop reaction 方法。

- [ ] **Step 7: 跑集成测试确认失败**

```bash
bun test tests/unit/packages/channel-feishu/feishu-completion-awareness.test.ts
```
预期：FAIL —— `runTurn` 的 finally 还没写完成信号/提醒逻辑。

- [ ] **Step 8: 实现 runTurn finally + 发送助手**

在 `channel.ts` import 增加：
```typescript
import { buildFeishuCompletionNotice } from "./completion-notice.js";
```
在 `runTurn` 顶部（`try` 前）加状态变量：
```typescript
    let turnStatus: "done" | "error" = "done";
```
在 `runTurn` 的 `catch (error)` 块里（现有 `if (active.cardController ...) await active.cardController.fail(...)` 之后、`throw error;` 之前）加：
```typescript
      turnStatus = "error";
```
把 `runTurn` 现有的 `finally` 块改为（在现有 `activeTasks` 清理 + `removeTypingIndicator` 之外、之前，加入完成感知）：
```typescript
    } finally {
      if (boundAlias) {
        this.activeTurns?.markInactive(chatKey, boundAlias);
        const stillForeground = this.sessions?.peekCurrentSessionAlias(chatKey) === boundAlias;
        if (!stillForeground && this.sessions) {
          await this.sessions.setBackgroundResult(chatKey, boundAlias, {
            text: "",
            status: turnStatus,
            finished_at: new Date().toISOString(),
          });
          await this.sendBackgroundCompletionNotice({
            runtime,
            chatId,
            messageId,
            boundAlias,
            status: turnStatus,
          });
        }
      }
      const stack = this.activeTasks.get(queueKey);
      if (stack) {
        const i = stack.indexOf(active);
        if (i >= 0) stack.splice(i, 1);
        if (stack.length === 0) this.activeTasks.delete(queueKey);
      }
      await removeTypingIndicator({
        client: runtime.client.sdk as unknown as FeishuReactionClient,
        state: active.typingState,
        accountId,
      });
    }
```
新增私有方法（放在 `runTurn` 附近）：
```typescript
  private async sendBackgroundCompletionNotice(input: {
    runtime: AccountRuntime;
    chatId: string;
    messageId: string;
    boundAlias: string;
    status: "done" | "error";
  }): Promise<void> {
    const text = buildFeishuCompletionNotice(toDisplaySessionAlias(input.boundAlias), input.status);
    try {
      await this.sendReplyWithGuard({
        runtime: input.runtime,
        chatId: input.chatId,
        replyToMessageId: input.messageId,
        text,
      });
    } catch (error) {
      await this.logger?.error("feishu.bg_notice.failed", "failed to send background completion notice", {
        chatId: input.chatId,
        boundAlias: input.boundAlias,
        message: error instanceof Error ? error.message : String(error),
      });
    }
  }
```
> 如 Step 5 显示 `sendReplyWithGuard` 不接受 `replyToMessageId`（或字段名不同），按其真实签名调整（去掉该字段或改名）。`toDisplaySessionAlias` 已在 Task 4 从 `weacpx/plugin-api` import。

- [ ] **Step 9: 跑测试 + 全量 + typecheck**

```bash
bun test tests/unit/packages/channel-feishu/feishu-completion-awareness.test.ts
bun test tests/unit/packages/channel-feishu/feishu-completion-notice.test.ts
node ./scripts/run-tests.mjs tests/unit
npx tsc --noEmit
```
预期：两个新测试 PASS；全量无新增 `(fail)`；tsc 干净。

- [ ] **Step 10: Commit**

```bash
git add packages/channel-feishu/src/channel.ts packages/channel-feishu/src/completion-notice.ts tests/unit/packages/channel-feishu/feishu-completion-notice.test.ts tests/unit/packages/channel-feishu/feishu-completion-awareness.test.ts
git commit -m "feat(feishu): record background completion signal + ping on switched-away turn finish"
```

---

## Phase 5 — `/cancel <alias>` 取消指定（含后台）会话

### Task 8: `/cancel <alias>` 在飞书定位并中止目标会话

**Files:**
- Modify: `packages/channel-feishu/src/channel.ts`（取消目标会话的本地中止）
- Test: `tests/unit/packages/channel-feishu/feishu-cancel-alias.test.ts`（补全 Task 5 建的文件）

> **本任务有真实未知（取消投递机制），第一步是 discovery。** 核心 `handleCancel`（`/cancel <alias>` → `resolveFuzzyAlias` → `transport.cancel(session)`，P2 已实现）是经 `agent.chat` 触发的，它中止的是 **acpx transport 会话**；而飞书在跑的 `agent.chat` 持有自己的 `AbortController` 与卡片。需确认：核心的 `transport.cancel` 是否足以让飞书那次在跑的 `agent.chat` 返回并让卡片收尾？还是飞书必须**额外**按 alias 在 `activeTasks` 里找到对应 task、`abortController.abort()` + 卡片定格？

- [ ] **Step 1: Discovery（不改代码）**

用 `command cat` 读：
- `src/commands/handlers/session-handler.ts` 的 `handleCancel`（确认 `/cancel <alias>` 走 `resolveFuzzyAlias` → 解析会话 → 何种 cancel 调用；P2 实现）。
- 该 cancel 调用最终落到 transport 的哪个方法（`command grep -rn "cancelTransportSession\|transport.cancel\|interaction.cancel" src/commands/ | command cat`）。
- 飞书 `runTurn` 里 `agent.chat` 收到 `abortSignal: abortController.signal`：当核心 `transport.cancel(session)` 中止 acpx 会话时，这个在跑的 `agent.chat`（它内部是 transport.prompt）是否会**抛错/返回**从而触发飞书的 `catch → cardController.fail` 收尾？读 `src/transport/` 里 prompt 与 cancel 的关系（`command grep -rn "abortSignal\|cancel" src/transport/acpx-bridge/acpx-bridge-transport.ts | command cat`）。

写 4-6 行结论：「`/cancel <alias>` 经核心 transport.cancel 中止 acpx；飞书在跑的 agent.chat 会/不会因此返回；卡片会/不会自动收尾」。

**GATE：** 若 discovery 表明 `transport.cancel` 已足以让飞书在跑 turn 返回且卡片经现有 `catch`/finally 收尾 → 则 `/cancel <alias>` **已经能工作**（核心 P2 + 飞书现有错误收尾），本任务只需补一个**验证测试**确认行为，并跳过额外本地中止实现。若 discovery 表明飞书 turn 不会因核心 cancel 而停（卡片会卡在 processing），则继续 Step 2 实现「飞书侧按 alias 本地中止」。

- [ ] **Step 2:（条件实现）按 alias 本地中止的失败测试**

仅当 Step 1 GATE 判定需要本地中止时。补全 `tests/unit/packages/channel-feishu/feishu-cancel-alias.test.ts`，新增：
```typescript
test("aborting by alias trips the matching task's AbortController and terminates its card", () => {
  const channel = makeFeishuChannelForTest();
  const aborted: string[] = [];
  const fakeCard = { isTerminated: () => false, abort: async () => { aborted.push("card"); } };
  const ac = new AbortController();
  const active = {
    accountId: "a", chatId: "c", messageId: "m",
    senderOpenId: "ou", chatType: "p2p",
    boundAlias: "feishu:a:c:codex",
    typingState: { messageId: "m", reactionId: null },
    abortController: ac, suppressed: false, cardController: fakeCard,
  };
  (channel as any).activeTasks.set("a:c", [active]);

  (channel as any).abortTaskByAlias("feishu:a:c", "feishu:a:c:codex");

  expect(ac.signal.aborted).toBe(true);
  expect(active.suppressed).toBe(true);
});
```

- [ ] **Step 3:（条件实现）跑测试确认失败**

```bash
bun test tests/unit/packages/channel-feishu/feishu-cancel-alias.test.ts
```
预期：FAIL —— `abortTaskByAlias` 不存在。

- [ ] **Step 4:（条件实现）实现 abortTaskByAlias 并接到取消路径**

在 `channel.ts` 加：
```typescript
  // Abort an in-flight turn for a SPECIFIC bound session alias (used so a
  // `/cancel <alias>` can stop a backgrounded session whose card is still
  // streaming). chatKey → queueKey is derived the same way handleMessageEvent
  // builds it; we scan that chat's active stack for the matching boundAlias.
  private abortTaskByAlias(chatKey: string, internalAlias: string): boolean {
    let hit = false;
    for (const stack of this.activeTasks.values()) {
      for (const t of stack) {
        if (t.boundAlias === internalAlias && !t.suppressed) {
          t.suppressed = true;
          try { t.abortController.abort(); } catch { /* never throws in practice */ }
          if (t.cardController && !t.cardController.isTerminated()) {
            void t.cardController.abort().catch(() => {});
          }
          hit = true;
        }
      }
    }
    return hit;
  }
```
> 接线点取决于 Step 1：若核心 `handleCancel` 的结果需要飞书侧配合，最干净的接法是——飞书检测到入站为 `/cancel <alias>` 时，在把命令交给 `agent.chat`（核心 transport.cancel）**之后**，也调 `this.abortTaskByAlias(chatKey, 解析出的 internalAlias)`。解析 internalAlias 用 `this.sessions?.resolveFuzzyAlias(chatKey, alias)`（返回 display alias，需再转 internal——参照核心 `handleCancel` 怎么从 display 到 internal；如复杂，Step 1 要确认 `resolveFuzzyAlias` 返回值与 internal 的映射）。**此接线细节以 Step 1 discovery 结论为准**；若 discovery 判定无需本地中止（GATE 走 happy path），跳过本步。

- [ ] **Step 5: 验证**

```bash
bun test tests/unit/packages/channel-feishu/feishu-cancel-alias.test.ts
node ./scripts/run-tests.mjs tests/unit
npx tsc --noEmit
```
预期：PASS；全量无新增 `(fail)`；tsc 干净。

- [ ] **Step 6: Commit**

```bash
git add packages/channel-feishu/src/channel.ts tests/unit/packages/channel-feishu/feishu-cancel-alias.test.ts
git commit -m "feat(feishu): /cancel <alias> aborts the targeted (possibly background) session"
```
> 若 Step 1 GATE 判定 `/cancel <alias>` 已自动可用，本 commit 只含验证测试，message 改为 `test(feishu): verify /cancel <alias> stops a backgrounded session via core transport cancel`。

---

## Phase 6 — 文档、构建、最终评审

### Task 9: 文档 + 全链路构建 + 最终评审

**Files:**
- Modify: `docs/commands.md`（如已记录微信实时切换，补一句飞书亦支持）
- 无新代码

- [ ] **Step 1: 更新文档**

```bash
command grep -n "实时\|实时切换\|后台\|/ss\b\|background" docs/commands.md | command cat
```
若 `docs/commands.md` 有微信实时切换/后台执行段落，在其旁补一行：
> 飞书频道同样支持任务执行中即时 `/ss`、`/use`、`/cancel` 切换/取消；被切走的会话在其卡片中继续流式执行至完成，完成后在当前会话推送提醒并在 `/sessions` 列表标记 ●（卡片已在时间线，故切回不重复回放）。
若无相关段落，跳过（不为本特性新开文档章节，避免范围蔓延）。

- [ ] **Step 2: 全链路构建 + 全量测试**

```bash
npx tsc --noEmit
bun run build
node ./scripts/run-tests.mjs tests/unit
```
预期：tsc 干净；build 成功（核心 + 飞书包都构建——`bun run build` 应链 `build:channel-feishu`，用 `command cat package.json` 确认；若未链，另跑 `bun run build:channel-feishu`）；全量无新增 `(fail)`。

- [ ] **Step 3: Commit（若改了文档）**

```bash
git add docs/commands.md
git commit -m "docs(commands): note feishu realtime session switching + background concurrency"
```

- [ ] **Step 4: 派发最终评审子代理**

对整条分支（从 Phase 1 起到此）做一次集成评审：①核心抽离零回归（weixin 行为不变）；②飞书并发与 control 抢占按预期、dispatch-time 绑定正确（排队期间切会话不串）；③完成信号/提醒/列表● 在 B 语义下自洽（无回放、无前台闸门）；④`/cancel <alias>` 行为正确；⑤plugin-api 运行时导出在 `dist/` 实际可用。评审通过后用 superpowers:finishing-a-development-branch 收尾。

---

## Self-review notes（spec 覆盖核对）

- **spec §2 卡片语义 B（无闸门/无回放）** → Phase 4 只写「完成信号 + 提醒」，**不**实现 foreground-gate / takeBackgroundResult 取 text；切回回放由核心 `handleSessionUse` 的既有 `takeBackgroundResult` 自动清除信号（关键事实 #1），B 语义下 `text:""` 故无内容回放。✓
- **spec §2 并发 A（每会话车道）** → Task 6（executor + boundAlias sessionKey）。✓
- **spec §2 完成感知（提醒 + 列表●）** → Task 7（提醒 + setBackgroundResult 完成信号）；列表● 由核心 `handleSessions` 自动（关键事实 #1）。✓
- **spec §2 取消（现状不变 + /cancel <alias>）** → Task 8（含 discovery gate）；裸停止词快速路径 `tryHandleAbortTrigger` 全程不动。✓
- **spec §2 车道逻辑抽到核心** → Task 1-3（移动 + 导出）。✓
- **spec §2 会话绑定（peek + boundSessionAlias）** → Task 6（dispatch-time `boundAlias` + metadata.boundSessionAlias）；核心消费已存在（关键事实 #2）。✓
- **spec §4 三层** → Phase 1（层1）、Phase 2（层2）、Phase 3-4（层3）。✓
- **spec §8 风险1（命令是否经核心 handler）** → 已由 discovery 证实「是」（关键事实 #1），无需额外接线。✓
- **spec §8 风险2（executor 移位回归）** → Task 1 Step 5 跑 weixin 全量。✓
- **spec §10 YAGNI（不做闸门/回放/元宝/全文本回放）** → 计划未含这些。✓

类型一致性：`boundAlias`（飞书 ActiveTask 字段，internal alias）↔ `boundSessionAlias`（核心 metadata 字段）—— 两个名字，Task 6 在 metadata 构造处做映射（`boundSessionAlias: boundAlias`），已对齐。`resolveTurnLane` 返回 `ConversationExecutorLane`，与 `executor.run` 的 `lane` 参数同型。✓
