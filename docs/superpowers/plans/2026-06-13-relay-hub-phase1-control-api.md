# Relay Hub 阶段一：Control API + relay-protocol 实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 为 relay hub（spec: `docs/superpowers/specs/2026-06-13-relay-hub-design.md`）打地基——核心新增 `src/control/`（ControlService 门面 + ControlEventBus 事件总线，经 `ChannelStartInput.control` 注入频道），以及独立协议包 `packages/relay-protocol`（信封编解码 + wire DTO）。

**Architecture:** ControlService 是现有服务（SessionService / ActiveTurnRegistry / ScheduledTaskService / OrchestrationService / ConsoleAgent）的类型化薄门面，自身只做聚合、in-flight turn 跟踪与事件发射，不持有状态。relay-protocol 是零依赖纯类型+编解码包，不 import xacpx。两者本阶段互不依赖（连接器在阶段二把二者接起来）。

**Tech Stack:** TypeScript、Bun（构建/测试）、bun:test。无新增运行时依赖。

**执行注意（来自仓库经验）：**
- 跑测试用 `node ./scripts/run-tests.mjs <dir>` 或逐文件 `bun test <file>`；**不要**整目录 `bun test tests/unit/...`（单进程模块状态泄漏会出现假失败）。
- 本机 hook 可能打乱 shell 读取文件的输出；读源码用 Read 工具，必要时 `command cat`。
- 不要动 `CLAUDE.md`（它是 `AGENTS.md` 的符号链接），文档导航改 `AGENTS.md`。
- 不要擅自 push / rebase / 改 lockfile；每个任务一个 commit。

---

## File Structure

```
packages/relay-protocol/
├── package.json                 # 新建：零依赖协议包
├── tsconfig.json                # 新建：仿 channel-feishu（无 paths 映射）
├── README.md                    # 新建：包说明
└── src/
    ├── index.ts                 # 新建：聚合导出
    ├── envelope.ts              # 新建：信封类型 + 编解码 + 版本校验
    └── dtos.ts                  # 新建：wire DTO（会话/定时/编排/事件）

src/control/
├── control-event-bus.ts         # 新建：ControlEvent 类型 + 总线
└── control-service.ts           # 新建：门面（sessions/prompt/scheduler/orchestration/executeCommand）

修改：
- src/sessions/active-turn-registry.ts   # 增 isActiveAnywhere(alias)
- src/channels/types.ts                  # ChannelStartInput 增可选 control 字段
- src/main.ts                            # 构造 ControlService，AppRuntime 增 control
- src/run-console.ts                     # startAll 透传 control
- src/plugin-api.ts                      # 导出 control 相关类型
- package.json                           # build:relay-protocol / clean:relay-protocol 脚本
- AGENTS.md                              # 文档导航补链接

测试：
- tests/unit/packages/relay-protocol/envelope.test.ts
- tests/unit/sessions/active-turn-registry.test.ts        # 追加用例
- tests/unit/control/control-event-bus.test.ts
- tests/unit/control/control-service-sessions.test.ts
- tests/unit/control/control-service-scheduled.test.ts
- tests/unit/control/control-service-orchestration.test.ts
- tests/unit/control/control-service-prompt.test.ts
- tests/unit/run-console.test.ts                          # 追加 control 透传用例

文档：
- docs/control-module.md          # 新建：src/control 模块说明
```

引用的现有 API（已核实签名）：
- `SessionService`：`listAllResolvedSessions(): ResolvedSession[]`、`createSession(alias, agent, workspace)`、`removeSession(alias): Promise<{wasActive}>`、`useSession(chatKey, alias)`（src/sessions/session-service.ts）。
- `ActiveTurnRegistry`：`markActive/markInactive/isActive`（src/sessions/active-turn-registry.ts，整文件 29 行）。
- `ScheduledTaskService`：`listPending(chatKey)`、`createTask(CreateScheduledTaskInput)`、`cancelPending(id, chatKey)`（src/scheduled/scheduled-service.ts）。
- `OrchestrationService`：`listTasks(filter?)`、`getTask(taskId)`、`requestTaskCancellation(CancelTaskInput)`（src/orchestration/orchestration-service.ts）。
- `ChatAgent` = `Agent`（src/weixin/agent/interface.ts:13）：`chat(request: ChatRequest): Promise<ChatResponse>`；`ChatRequest.metadata: ChatRequestMetadata`（含 `chatType`/`senderId`/`isOwner`），`reply?`, `abortSignal?`。
- `buildApp`（src/main.ts）：`sessions`(:236)、`activeTurns`(:240)、`scheduledService`(:241)、`orchestration`(:612)、`agent = new ConsoleAgent(router, logger)`(:758)；返回对象 :810-851。
- `ChannelStartInput` 装配点：src/run-console.ts:186-197。
- `ResolvedSession` 在 src/transport/types.ts。**执行 Task 6 前先 Read 确认其字段名**（预期含 `alias`/`agent`/`workspace`/`transportSession`；若有出入，按实际字段调整 `ControlSessionInfo` 映射，不要新造字段）。

---

### Task 1: packages/relay-protocol 包脚手架 + 构建脚本

**Files:**
- Create: `packages/relay-protocol/package.json`
- Create: `packages/relay-protocol/tsconfig.json`
- Create: `packages/relay-protocol/README.md`
- Create: `packages/relay-protocol/src/index.ts`
- Modify: `package.json`（根，scripts）

- [ ] **Step 1: 创建 package.json**

```json
{
  "name": "@ganglion/xacpx-relay-protocol",
  "version": "0.1.0",
  "description": "Shared wire protocol types and codecs for the xacpx relay hub.",
  "license": "MIT",
  "keywords": ["xacpx", "relay", "protocol"],
  "repository": {
    "type": "git",
    "url": "git+https://github.com/gadzan/xacpx.git",
    "directory": "packages/relay-protocol"
  },
  "type": "module",
  "main": "./dist/index.js",
  "types": "./dist/index.d.ts",
  "exports": {
    ".": {
      "types": "./dist/index.d.ts",
      "default": "./dist/index.js"
    }
  },
  "files": ["dist", "README.md"],
  "publishConfig": {
    "access": "public"
  }
}
```

- [ ] **Step 2: 创建 tsconfig.json**（仿 channel-feishu，但本包不依赖 xacpx，无 paths）

```json
{
  "extends": "../../tsconfig.json",
  "compilerOptions": {
    "noEmit": false,
    "allowImportingTsExtensions": false,
    "emitDeclarationOnly": true,
    "declaration": true,
    "declarationMap": false,
    "rootDir": "src",
    "outDir": "dist",
    "ignoreDeprecations": "6.0"
  },
  "include": ["src/**/*.ts"]
}
```

- [ ] **Step 3: 创建 src/index.ts 与 README.md**

`src/index.ts`（envelope/dtos 在后续任务补，先建占位导出避免空模块）：

```ts
export const RELAY_PROTOCOL_PACKAGE = "@ganglion/xacpx-relay-protocol";
```

`README.md`：

```markdown
# @ganglion/xacpx-relay-protocol

Shared wire protocol for the xacpx relay hub: the JSON envelope exchanged over
WebSocket between xacpx instances, the relay server, and the web frontend, plus
the wire DTOs that mirror the core Control API surface.

Pure types + codecs. No runtime dependencies; does not depend on xacpx.

See `docs/superpowers/specs/2026-06-13-relay-hub-design.md` in the repo root for
the overall design.
```

- [ ] **Step 4: 根 package.json 加构建脚本**

先 Read 根 `package.json`，找到 `clean:channel-feishu` 与 `build:channel-feishu` 的写法，照其风格新增两条（本包无 xacpx 依赖：不需要 `build:plugin-api` 前置、不需要 `--external xacpx`）：

```json
"clean:relay-protocol": "rm -rf ./packages/relay-protocol/dist",
"build:relay-protocol": "bun run clean:relay-protocol && bun build ./packages/relay-protocol/src/index.ts --outdir ./packages/relay-protocol/dist --target node && tsc -p packages/relay-protocol/tsconfig.json",
```

（若 `clean:channel-feishu` 用的不是 `rm -rf`，以现有写法为准。）并把 `build:packages` 末尾追加 ` && bun run build:relay-protocol`。

- [ ] **Step 5: 验证构建与类型检查**

Run: `bun run build:relay-protocol && npx tsc --noEmit`
Expected: dist/ 下生成 index.js + index.d.ts；tsc 无报错。

- [ ] **Step 6: Commit**

```bash
git add packages/relay-protocol package.json
git commit -m "feat(relay-protocol): scaffold protocol package and build scripts"
```

---

### Task 2: 协议信封类型与编解码（TDD）

**Files:**
- Create: `packages/relay-protocol/src/envelope.ts`
- Modify: `packages/relay-protocol/src/index.ts`
- Test: `tests/unit/packages/relay-protocol/envelope.test.ts`

- [ ] **Step 1: 写失败测试**

```ts
import { expect, test } from "bun:test";

import {
  RELAY_PROTOCOL_VERSION,
  decodeEnvelope,
  encodeEnvelope,
  type RelayEnvelope,
} from "../../../../packages/relay-protocol/src/envelope";

test("encode/decode roundtrips a request envelope", () => {
  const envelope: RelayEnvelope = {
    protocolVersion: RELAY_PROTOCOL_VERSION,
    kind: "req",
    id: "req-1",
    type: "instance.sessions.list",
    payload: { chatKey: "relay:acct-1" },
  };

  const decoded = decodeEnvelope(encodeEnvelope(envelope));
  expect(decoded).toEqual({ ok: true, envelope });
});

test("decode rejects invalid JSON", () => {
  expect(decodeEnvelope("{nope")).toEqual({ ok: false, error: "invalid-json" });
});

test("decode rejects structurally invalid envelopes", () => {
  expect(decodeEnvelope(JSON.stringify({ protocolVersion: 1, kind: "req", type: "x" }))).toEqual({
    ok: false,
    error: "invalid-envelope",
  });
  expect(decodeEnvelope(JSON.stringify({ protocolVersion: 1, kind: "nope", id: "1", type: "x" }))).toEqual({
    ok: false,
    error: "invalid-envelope",
  });
  expect(decodeEnvelope(JSON.stringify({ protocolVersion: 1, kind: "event", type: "" }))).toEqual({
    ok: false,
    error: "invalid-envelope",
  });
});

test("decode reports version mismatch with detail", () => {
  const decoded = decodeEnvelope(
    JSON.stringify({ protocolVersion: 999, kind: "event", type: "control.sessions-changed" }),
  );
  expect(decoded.ok).toBe(false);
  if (!decoded.ok) {
    expect(decoded.error).toBe("version-mismatch");
    expect(decoded.detail).toContain("999");
  }
});

test("event envelopes do not require an id", () => {
  const decoded = decodeEnvelope(
    JSON.stringify({ protocolVersion: RELAY_PROTOCOL_VERSION, kind: "event", type: "control.sessions-changed" }),
  );
  expect(decoded.ok).toBe(true);
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `bun test tests/unit/packages/relay-protocol/envelope.test.ts`
Expected: FAIL（envelope 模块不存在）。

- [ ] **Step 3: 实现 envelope.ts**

```ts
export const RELAY_PROTOCOL_VERSION = 1;

export type EnvelopeKind = "req" | "res" | "event";

export interface RelayEnvelope {
  protocolVersion: number;
  kind: EnvelopeKind;
  /** Correlates res to req. Required for req/res; absent for event. */
  id?: string;
  /** Namespaced message type, e.g. "instance.sessions.list". */
  type: string;
  payload?: unknown;
}

export type DecodeEnvelopeResult =
  | { ok: true; envelope: RelayEnvelope }
  | { ok: false; error: "invalid-json" | "invalid-envelope" | "version-mismatch"; detail?: string };

export function encodeEnvelope(envelope: RelayEnvelope): string {
  return JSON.stringify(envelope);
}

export function decodeEnvelope(line: string): DecodeEnvelopeResult {
  let raw: unknown;
  try {
    raw = JSON.parse(line);
  } catch {
    return { ok: false, error: "invalid-json" };
  }
  if (!isEnvelopeShape(raw)) {
    return { ok: false, error: "invalid-envelope" };
  }
  if (raw.protocolVersion !== RELAY_PROTOCOL_VERSION) {
    return {
      ok: false,
      error: "version-mismatch",
      detail: `expected protocolVersion ${RELAY_PROTOCOL_VERSION}, got ${raw.protocolVersion}`,
    };
  }
  return { ok: true, envelope: raw };
}

function isEnvelopeShape(value: unknown): value is RelayEnvelope {
  if (typeof value !== "object" || value === null) {
    return false;
  }
  const candidate = value as Record<string, unknown>;
  if (typeof candidate.protocolVersion !== "number") return false;
  if (candidate.kind !== "req" && candidate.kind !== "res" && candidate.kind !== "event") return false;
  if (typeof candidate.type !== "string" || candidate.type.length === 0) return false;
  if (candidate.id !== undefined && typeof candidate.id !== "string") return false;
  if ((candidate.kind === "req" || candidate.kind === "res") && typeof candidate.id !== "string") return false;
  return true;
}
```

`src/index.ts` 改为：

```ts
export * from "./envelope.js";
```

- [ ] **Step 4: 跑测试确认通过**

Run: `bun test tests/unit/packages/relay-protocol/envelope.test.ts && npx tsc --noEmit`
Expected: PASS，tsc 无报错。

- [ ] **Step 5: Commit**

```bash
git add packages/relay-protocol/src tests/unit/packages/relay-protocol
git commit -m "feat(relay-protocol): envelope types and codec with version check"
```

---

### Task 3: wire DTO 类型

**Files:**
- Create: `packages/relay-protocol/src/dtos.ts`
- Modify: `packages/relay-protocol/src/index.ts`

纯类型文件（无运行时逻辑，不需要单测；tsc 把关）。DTO 字段是 camelCase 的稳定 wire 形态，与核心 record（snake_case 的 `ScheduledTaskRecord` 等）解耦；映射函数属于阶段二连接器。

- [ ] **Step 1: 创建 dtos.ts**

```ts
/** Wire mirror of the core control session listing. */
export interface SessionDto {
  alias: string;
  agent: string;
  workspace: string;
  transportSession: string;
  running: boolean;
}

export type ScheduledTaskStatusDto =
  | "pending"
  | "triggering"
  | "executed"
  | "cancelled"
  | "missed"
  | "failed";

export interface ScheduledTaskDto {
  id: string;
  sessionAlias: string;
  executeAt: string;
  message: string;
  status: ScheduledTaskStatusDto;
  createdAt: string;
}

export type OrchestrationTaskStatusDto =
  | "needs_confirmation"
  | "queued"
  | "running"
  | "blocked"
  | "waiting_for_human"
  | "completed"
  | "failed"
  | "cancelled";

export interface OrchestrationTaskDto {
  taskId: string;
  status: OrchestrationTaskStatusDto;
  targetAgent: string;
  workspace: string;
  task: string;
  summary: string;
  createdAt: string;
  updatedAt: string;
}

/** Wire mirror of src/control ControlEvent. */
export type ControlEventDto =
  | { type: "turn-output"; chatKey: string; sessionAlias: string; chunk: string }
  | { type: "turn-finished"; chatKey: string; sessionAlias: string; ok: boolean; errorMessage?: string }
  | { type: "sessions-changed" }
  | { type: "scheduled-changed"; chatKey: string }
  | { type: "orchestration-changed" };
```

`src/index.ts`：

```ts
export * from "./envelope.js";
export * from "./dtos.js";
```

- [ ] **Step 2: 验证**

Run: `bun run build:relay-protocol && npx tsc --noEmit`
Expected: 构建通过，dist 含 dtos.d.ts。

- [ ] **Step 3: Commit**

```bash
git add packages/relay-protocol/src
git commit -m "feat(relay-protocol): wire DTOs for sessions, tasks, and control events"
```

---

### Task 4: ActiveTurnRegistry.isActiveAnywhere（TDD）

**Files:**
- Modify: `src/sessions/active-turn-registry.ts`
- Test: `tests/unit/sessions/active-turn-registry.test.ts`（追加用例）

背景：registry 按 chatKey 分桶，ControlService 列会话时需要「该 alias 在任一 chat 是否有 turn 在跑」的全局视图。

- [ ] **Step 1: 在现有测试文件追加失败用例**

```ts
test("isActiveAnywhere reports activity across chat keys", () => {
  const registry = createActiveTurnRegistry();
  expect(registry.isActiveAnywhere("backend")).toBe(false);

  registry.markActive("weixin:user-1", "backend");
  expect(registry.isActiveAnywhere("backend")).toBe(true);
  expect(registry.isActiveAnywhere("docs")).toBe(false);

  registry.markInactive("weixin:user-1", "backend");
  expect(registry.isActiveAnywhere("backend")).toBe(false);
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `bun test tests/unit/sessions/active-turn-registry.test.ts`
Expected: FAIL（isActiveAnywhere 不存在）。

- [ ] **Step 3: 实现**

接口加一行：

```ts
export interface ActiveTurnRegistry {
  markActive(chatKey: string, alias: string): void;
  markInactive(chatKey: string, alias: string): void;
  isActive(chatKey: string, alias: string): boolean;
  /** True when any chat currently has a turn running for this alias. */
  isActiveAnywhere(alias: string): boolean;
}
```

工厂返回对象加实现：

```ts
    isActiveAnywhere(alias) {
      for (const set of byChat.values()) {
        if (set.has(alias)) return true;
      }
      return false;
    },
```

- [ ] **Step 4: 跑测试确认通过**

Run: `bun test tests/unit/sessions/active-turn-registry.test.ts && npx tsc --noEmit`
Expected: PASS。（接口加了必选方法——tsc 若报其它 ActiveTurnRegistry 假实现缺方法，给该 fake 补一个 `isActiveAnywhere: () => false`。）

- [ ] **Step 5: Commit**

```bash
git add src/sessions/active-turn-registry.ts tests/unit/sessions/active-turn-registry.test.ts
git commit -m "feat(sessions): add ActiveTurnRegistry.isActiveAnywhere for control facade"
```

---

### Task 5: ControlEventBus（TDD）

**Files:**
- Create: `src/control/control-event-bus.ts`
- Test: `tests/unit/control/control-event-bus.test.ts`

- [ ] **Step 1: 写失败测试**

```ts
import { expect, test } from "bun:test";

import { createControlEventBus, type ControlEvent } from "../../../src/control/control-event-bus";

test("delivers events to subscribers until unsubscribed", () => {
  const bus = createControlEventBus();
  const seen: ControlEvent[] = [];
  const unsubscribe = bus.subscribe((event) => seen.push(event));

  bus.emit({ type: "sessions-changed" });
  expect(seen).toEqual([{ type: "sessions-changed" }]);

  unsubscribe();
  bus.emit({ type: "orchestration-changed" });
  expect(seen).toHaveLength(1);
});

test("a throwing listener does not break other listeners", () => {
  const bus = createControlEventBus();
  const seen: string[] = [];
  bus.subscribe(() => {
    throw new Error("boom");
  });
  bus.subscribe((event) => seen.push(event.type));

  bus.emit({ type: "scheduled-changed", chatKey: "relay:acct-1" });
  expect(seen).toEqual(["scheduled-changed"]);
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `bun test tests/unit/control/control-event-bus.test.ts`
Expected: FAIL（模块不存在）。

- [ ] **Step 3: 实现 control-event-bus.ts**

```ts
import type { AppLogger } from "../logging/app-logger";

export type ControlEvent =
  | { type: "turn-output"; chatKey: string; sessionAlias: string; chunk: string }
  | { type: "turn-finished"; chatKey: string; sessionAlias: string; ok: boolean; errorMessage?: string }
  | { type: "sessions-changed" }
  | { type: "scheduled-changed"; chatKey: string }
  | { type: "orchestration-changed" };

export type ControlEventListener = (event: ControlEvent) => void;

export interface ControlEventBus {
  subscribe(listener: ControlEventListener): () => void;
  emit(event: ControlEvent): void;
}

export function createControlEventBus(logger?: AppLogger): ControlEventBus {
  const listeners = new Set<ControlEventListener>();
  return {
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    emit(event) {
      for (const listener of [...listeners]) {
        try {
          listener(event);
        } catch (error) {
          void logger?.warn("control.event_listener_failed", "control event listener threw", {
            eventType: event.type,
            error: error instanceof Error ? error.message : String(error),
          });
        }
      }
    },
  };
}
```

（写之前 Read `src/logging/app-logger.ts` 确认 `warn(event, message, context)` 的签名；若方法名/形参不同，按实际调整。）

- [ ] **Step 4: 跑测试确认通过**

Run: `bun test tests/unit/control/control-event-bus.test.ts && npx tsc --noEmit`
Expected: PASS。

- [ ] **Step 5: Commit**

```bash
git add src/control/control-event-bus.ts tests/unit/control/control-event-bus.test.ts
git commit -m "feat(control): add ControlEventBus with isolated listener failures"
```

---

### Task 6: ControlService — sessions 域（TDD）

**Files:**
- Create: `src/control/control-service.ts`
- Test: `tests/unit/control/control-service-sessions.test.ts`

依赖统一用 `Pick<真实类, ...>` 收窄，保证真实例结构兼容、fake 易写。**先 Read `src/transport/types.ts` 确认 `ResolvedSession` 字段名**（预期 `alias`/`agent`/`workspace`/`transportSession`）。

- [ ] **Step 1: 写失败测试**

```ts
import { expect, test } from "bun:test";

import { ControlService } from "../../../src/control/control-service";
import { createControlEventBus, type ControlEvent } from "../../../src/control/control-event-bus";

function makeDeps() {
  const events = createControlEventBus();
  const seen: ControlEvent[] = [];
  events.subscribe((event) => seen.push(event));
  const session = {
    alias: "backend",
    agent: "claude",
    workspace: "/ws/backend",
    transportSession: "xacpx-backend",
  };
  const deps = {
    agent: { chat: async () => ({ text: "" }) },
    sessions: {
      listAllResolvedSessions: () => [session],
      createSession: async (alias: string, agent: string, workspace: string) => ({
        ...session,
        alias,
        agent,
        workspace,
      }),
      removeSession: async (_alias: string) => ({ wasActive: true }),
      useSession: async () => ({ alias: "backend", agent: "claude", workspace: "/ws/backend" }),
    },
    activeTurns: { isActiveAnywhere: (alias: string) => alias === "backend" },
    scheduled: {
      listPending: () => [],
      createTask: async () => {
        throw new Error("unused");
      },
      cancelPending: async () => false,
    },
    orchestration: {
      listTasks: async () => [],
      getTask: async () => null,
      requestTaskCancellation: async () => {
        throw new Error("unused");
      },
    },
    events,
  };
  return { deps, seen };
}

test("listSessions maps resolved sessions with running flag", () => {
  const { deps } = makeDeps();
  const control = new ControlService(deps as never);

  expect(control.listSessions()).toEqual([
    {
      alias: "backend",
      agent: "claude",
      workspace: "/ws/backend",
      transportSession: "xacpx-backend",
      running: true,
    },
  ]);
});

test("createSession delegates and emits sessions-changed", async () => {
  const { deps, seen } = makeDeps();
  const control = new ControlService(deps as never);

  const created = await control.createSession("docs", "codex", "/ws/docs");
  expect(created.alias).toBe("docs");
  expect(seen).toContainEqual({ type: "sessions-changed" });
});

test("removeSession delegates and emits sessions-changed", async () => {
  const { deps, seen } = makeDeps();
  const control = new ControlService(deps as never);

  const result = await control.removeSession("backend");
  expect(result.wasActive).toBe(true);
  expect(seen).toContainEqual({ type: "sessions-changed" });
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `bun test tests/unit/control/control-service-sessions.test.ts`
Expected: FAIL（模块不存在）。

- [ ] **Step 3: 实现 control-service.ts（本任务只含 sessions 域；后续任务在同文件追加方法）**

```ts
import type { Agent as ChatAgent } from "../weixin/agent/interface";
import type { SessionService } from "../sessions/session-service";
import type { ActiveTurnRegistry } from "../sessions/active-turn-registry";
import type { ScheduledTaskService } from "../scheduled/scheduled-service";
import type { OrchestrationService } from "../orchestration/orchestration-service";
import type { ControlEventBus } from "./control-event-bus";

export interface ControlSessionInfo {
  alias: string;
  agent: string;
  workspace: string;
  transportSession: string;
  running: boolean;
}

export interface ControlServiceDeps {
  agent: Pick<ChatAgent, "chat">;
  sessions: Pick<
    SessionService,
    "listAllResolvedSessions" | "createSession" | "removeSession" | "useSession"
  >;
  activeTurns: Pick<ActiveTurnRegistry, "isActiveAnywhere">;
  scheduled: Pick<ScheduledTaskService, "listPending" | "createTask" | "cancelPending">;
  orchestration: Pick<OrchestrationService, "listTasks" | "getTask" | "requestTaskCancellation">;
  events: ControlEventBus;
}

// Thin structured facade over core services for non-text consumers (the relay
// connector first). Holds no state of its own beyond in-flight turn tracking.
export class ControlService {
  constructor(private readonly deps: ControlServiceDeps) {}

  get events(): ControlEventBus {
    return this.deps.events;
  }

  listSessions(): ControlSessionInfo[] {
    return this.deps.sessions.listAllResolvedSessions().map((session) => ({
      alias: session.alias,
      agent: session.agent,
      workspace: session.workspace,
      transportSession: session.transportSession,
      running: this.deps.activeTurns.isActiveAnywhere(session.alias),
    }));
  }

  async createSession(alias: string, agent: string, workspace: string): Promise<ControlSessionInfo> {
    const session = await this.deps.sessions.createSession(alias, agent, workspace);
    this.deps.events.emit({ type: "sessions-changed" });
    return {
      alias: session.alias,
      agent: session.agent,
      workspace: session.workspace,
      transportSession: session.transportSession,
      running: false,
    };
  }

  async removeSession(alias: string): Promise<{ wasActive: boolean }> {
    const result = await this.deps.sessions.removeSession(alias);
    this.deps.events.emit({ type: "sessions-changed" });
    return result;
  }
}
```

- [ ] **Step 4: 跑测试确认通过**

Run: `bun test tests/unit/control/control-service-sessions.test.ts && npx tsc --noEmit`
Expected: PASS。

- [ ] **Step 5: Commit**

```bash
git add src/control/control-service.ts tests/unit/control/control-service-sessions.test.ts
git commit -m "feat(control): ControlService sessions domain"
```

---

### Task 7: ControlService — scheduler 域（TDD）

**Files:**
- Modify: `src/control/control-service.ts`
- Test: `tests/unit/control/control-service-scheduled.test.ts`

- [ ] **Step 1: 写失败测试**

```ts
import { expect, test } from "bun:test";

import { ControlService } from "../../../src/control/control-service";
import { createControlEventBus, type ControlEvent } from "../../../src/control/control-event-bus";
import type { ScheduledTaskRecord } from "../../../src/scheduled/scheduled-types";

const record: ScheduledTaskRecord = {
  id: "ab12",
  chat_key: "relay:acct-1",
  session_alias: "backend",
  execute_at: "2026-06-14T10:00:00.000Z",
  message: "check CI",
  status: "pending",
  created_at: "2026-06-13T10:00:00.000Z",
};

function makeControl() {
  const events = createControlEventBus();
  const seen: ControlEvent[] = [];
  events.subscribe((event) => seen.push(event));
  const calls: Record<string, unknown[]> = { create: [], cancel: [] };
  const control = new ControlService({
    agent: { chat: async () => ({ text: "" }) },
    sessions: {} as never,
    activeTurns: { isActiveAnywhere: () => false },
    scheduled: {
      listPending: (chatKey: string) => (chatKey === "relay:acct-1" ? [record] : []),
      createTask: async (input: unknown) => {
        calls.create.push(input);
        return record;
      },
      cancelPending: async (id: string, _chatKey: string) => {
        calls.cancel.push(id);
        return id === "ab12";
      },
    },
    orchestration: {} as never,
    events,
  } as never);
  return { control, seen, calls };
}

test("listScheduledTasks scopes to the chat key", () => {
  const { control } = makeControl();
  expect(control.listScheduledTasks("relay:acct-1")).toEqual([record]);
  expect(control.listScheduledTasks("relay:other")).toEqual([]);
});

test("createScheduledTask delegates and emits scheduled-changed", async () => {
  const { control, seen, calls } = makeControl();
  const task = await control.createScheduledTask({
    chatKey: "relay:acct-1",
    sessionAlias: "backend",
    executeAt: new Date("2026-06-14T10:00:00.000Z"),
    message: "check CI",
  });
  expect(task.id).toBe("ab12");
  expect(calls.create).toHaveLength(1);
  expect(seen).toContainEqual({ type: "scheduled-changed", chatKey: "relay:acct-1" });
});

test("cancelScheduledTask emits only when something was cancelled", async () => {
  const { control, seen } = makeControl();
  expect(await control.cancelScheduledTask("zz99", "relay:acct-1")).toBe(false);
  expect(seen).toHaveLength(0);
  expect(await control.cancelScheduledTask("ab12", "relay:acct-1")).toBe(true);
  expect(seen).toContainEqual({ type: "scheduled-changed", chatKey: "relay:acct-1" });
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `bun test tests/unit/control/control-service-scheduled.test.ts`
Expected: FAIL（方法不存在）。

- [ ] **Step 3: 在 ControlService 追加方法与 import**

```ts
import type {
  CreateScheduledTaskInput,
  ScheduledTaskService,
} from "../scheduled/scheduled-service";
import type { ScheduledTaskRecord } from "../scheduled/scheduled-types";
```

```ts
  listScheduledTasks(chatKey: string): ScheduledTaskRecord[] {
    return this.deps.scheduled.listPending(chatKey);
  }

  async createScheduledTask(input: CreateScheduledTaskInput): Promise<ScheduledTaskRecord> {
    const task = await this.deps.scheduled.createTask(input);
    this.deps.events.emit({ type: "scheduled-changed", chatKey: input.chatKey });
    return task;
  }

  async cancelScheduledTask(id: string, chatKey: string): Promise<boolean> {
    const cancelled = await this.deps.scheduled.cancelPending(id, chatKey);
    if (cancelled) {
      this.deps.events.emit({ type: "scheduled-changed", chatKey });
    }
    return cancelled;
  }
```

- [ ] **Step 4: 跑测试确认通过**

Run: `bun test tests/unit/control/control-service-scheduled.test.ts && npx tsc --noEmit`
Expected: PASS。

- [ ] **Step 5: Commit**

```bash
git add src/control/control-service.ts tests/unit/control/control-service-scheduled.test.ts
git commit -m "feat(control): ControlService scheduler domain"
```

---

### Task 8: ControlService — orchestration 域（TDD）

**Files:**
- Modify: `src/control/control-service.ts`
- Test: `tests/unit/control/control-service-orchestration.test.ts`

- [ ] **Step 1: 写失败测试**

```ts
import { expect, test } from "bun:test";

import { ControlService } from "../../../src/control/control-service";
import { createControlEventBus, type ControlEvent } from "../../../src/control/control-event-bus";
import type { OrchestrationTaskRecord } from "../../../src/orchestration/orchestration-types";

const task = {
  taskId: "task-1",
  sourceHandle: "h1",
  sourceKind: "session",
  coordinatorSession: "coord",
  workspace: "/ws/backend",
  targetAgent: "claude",
  task: "do the thing",
  status: "running",
  summary: "",
  resultText: "",
  createdAt: "2026-06-13T10:00:00.000Z",
  updatedAt: "2026-06-13T10:05:00.000Z",
} as OrchestrationTaskRecord;

function makeControl() {
  const events = createControlEventBus();
  const seen: ControlEvent[] = [];
  events.subscribe((event) => seen.push(event));
  const control = new ControlService({
    agent: { chat: async () => ({ text: "" }) },
    sessions: {} as never,
    activeTurns: { isActiveAnywhere: () => false },
    scheduled: {} as never,
    orchestration: {
      listTasks: async () => [task],
      getTask: async (taskId: string) => (taskId === "task-1" ? task : null),
      requestTaskCancellation: async () => ({ ...task, status: "cancelled" }),
    },
    events,
  } as never);
  return { control, seen };
}

test("lists and fetches orchestration tasks", async () => {
  const { control } = makeControl();
  expect(await control.listOrchestrationTasks()).toEqual([task]);
  expect(await control.getOrchestrationTask("task-1")).toEqual(task);
  expect(await control.getOrchestrationTask("nope")).toBeNull();
});

test("cancelOrchestrationTask delegates and emits orchestration-changed", async () => {
  const { control, seen } = makeControl();
  const cancelled = await control.cancelOrchestrationTask({ taskId: "task-1" });
  expect(cancelled.status).toBe("cancelled");
  expect(seen).toContainEqual({ type: "orchestration-changed" });
});
```

（`sourceKind: "session"` 若与 `OrchestrationSourceKind` 实际枚举不符，Read `src/orchestration/orchestration-types.ts:11` 取一个合法值替换。）

- [ ] **Step 2: 跑测试确认失败**

Run: `bun test tests/unit/control/control-service-orchestration.test.ts`
Expected: FAIL（方法不存在）。

- [ ] **Step 3: 追加方法与 import**

```ts
import type {
  CancelTaskInput,
  OrchestrationService,
  OrchestrationTaskFilter,
} from "../orchestration/orchestration-service";
import type { OrchestrationTaskRecord } from "../orchestration/orchestration-types";
```

```ts
  listOrchestrationTasks(filter?: OrchestrationTaskFilter): Promise<OrchestrationTaskRecord[]> {
    return this.deps.orchestration.listTasks(filter);
  }

  getOrchestrationTask(taskId: string): Promise<OrchestrationTaskRecord | null> {
    return this.deps.orchestration.getTask(taskId);
  }

  async cancelOrchestrationTask(input: CancelTaskInput): Promise<OrchestrationTaskRecord> {
    const task = await this.deps.orchestration.requestTaskCancellation(input);
    this.deps.events.emit({ type: "orchestration-changed" });
    return task;
  }
```

（若 `CancelTaskInput`/`OrchestrationTaskFilter` 未从 orchestration-service.ts 导出，先在该文件确认——报告显示二者均为 export。）

- [ ] **Step 4: 跑测试确认通过**

Run: `bun test tests/unit/control/control-service-orchestration.test.ts && npx tsc --noEmit`
Expected: PASS。

- [ ] **Step 5: Commit**

```bash
git add src/control/control-service.ts tests/unit/control/control-service-orchestration.test.ts
git commit -m "feat(control): ControlService orchestration domain"
```

---

### Task 9: ControlService — prompt / cancelTurn / executeCommand（TDD）

**Files:**
- Modify: `src/control/control-service.ts`
- Test: `tests/unit/control/control-service-prompt.test.ts`

语义：
- `prompt` 先 `useSession(chatKey, alias)` 绑定当前会话，再走 `agent.chat`；流式输出经 `reply` 回调转成 `turn-output` 事件；终态发 `turn-finished`。
- 同一 (chatKey, alias) 同时只允许一个 in-flight turn；`cancelTurn` 通过 AbortController 中止。
- metadata 固定 `channel: "control"`、`chatType: "direct"`，`senderId`/`isOwner` 由调用方传入（满足 fail-closed 路由契约）。
- `executeCommand` 不做会话切换，收集 reply 分片 + 终态文本拼接返回。

- [ ] **Step 1: 写失败测试**

```ts
import { expect, test } from "bun:test";

import { ControlService } from "../../../src/control/control-service";
import { createControlEventBus, type ControlEvent } from "../../../src/control/control-event-bus";
import type { ChatRequest, ChatResponse } from "../../../src/weixin/agent/interface";

function makeControl(chatImpl: (request: ChatRequest) => Promise<ChatResponse>) {
  const events = createControlEventBus();
  const seen: ControlEvent[] = [];
  events.subscribe((event) => seen.push(event));
  const used: string[] = [];
  const control = new ControlService({
    agent: { chat: chatImpl },
    sessions: {
      listAllResolvedSessions: () => [],
      createSession: async () => {
        throw new Error("unused");
      },
      removeSession: async () => ({ wasActive: false }),
      useSession: async (chatKey: string, alias: string) => {
        if (alias === "missing") throw new Error("unknown session");
        used.push(`${chatKey}:${alias}`);
        return { alias, agent: "claude", workspace: "/ws" };
      },
    },
    activeTurns: { isActiveAnywhere: () => false },
    scheduled: {} as never,
    orchestration: {} as never,
    events,
  } as never);
  return { control, seen, used };
}

test("prompt binds session, streams chunks as events, and reports completion", async () => {
  let captured: ChatRequest | undefined;
  const { control, seen, used } = makeControl(async (request) => {
    captured = request;
    await request.reply?.("chunk-1");
    return { text: "final" };
  });

  const result = await control.prompt({
    chatKey: "relay:acct-1",
    sessionAlias: "backend",
    text: "run tests",
    senderId: "acct-1",
    isOwner: true,
  });

  expect(result).toEqual({ ok: true, text: "final" });
  expect(used).toEqual(["relay:acct-1:backend"]);
  expect(captured?.conversationId).toBe("relay:acct-1");
  expect(captured?.metadata).toEqual({
    channel: "control",
    chatType: "direct",
    senderId: "acct-1",
    isOwner: true,
  });
  expect(seen).toEqual([
    { type: "turn-output", chatKey: "relay:acct-1", sessionAlias: "backend", chunk: "chunk-1" },
    { type: "turn-output", chatKey: "relay:acct-1", sessionAlias: "backend", chunk: "final" },
    { type: "turn-finished", chatKey: "relay:acct-1", sessionAlias: "backend", ok: true },
  ]);
});

test("prompt rejects unknown session without emitting turn events", async () => {
  const { control, seen } = makeControl(async () => ({ text: "" }));
  const result = await control.prompt({
    chatKey: "relay:acct-1",
    sessionAlias: "missing",
    text: "hi",
    senderId: "acct-1",
  });
  expect(result.ok).toBe(false);
  expect(result.errorMessage).toContain("unknown session");
  expect(seen).toHaveLength(0);
});

test("second concurrent prompt on the same session is rejected; cancelTurn aborts", async () => {
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const { control } = makeControl(async (request) => {
    await new Promise<void>((resolve) => {
      request.abortSignal?.addEventListener("abort", () => resolve(), { once: true });
      void gate.then(resolve);
    });
    if (request.abortSignal?.aborted) throw new Error("aborted");
    return { text: "done" };
  });

  const first = control.prompt({
    chatKey: "relay:acct-1",
    sessionAlias: "backend",
    text: "long task",
    senderId: "acct-1",
  });
  await Promise.resolve();

  const second = await control.prompt({
    chatKey: "relay:acct-1",
    sessionAlias: "backend",
    text: "again",
    senderId: "acct-1",
  });
  expect(second).toEqual({ ok: false, errorMessage: "turn-already-running" });

  expect(control.cancelTurn("relay:acct-1", "backend")).toBe(true);
  const result = await first;
  expect(result.ok).toBe(false);
  release();

  expect(control.cancelTurn("relay:acct-1", "backend")).toBe(false);
});

test("prompt failure emits turn-finished with the error", async () => {
  const { control, seen } = makeControl(async () => {
    throw new Error("transport exploded");
  });
  const result = await control.prompt({
    chatKey: "relay:acct-1",
    sessionAlias: "backend",
    text: "hi",
    senderId: "acct-1",
  });
  expect(result).toEqual({ ok: false, errorMessage: "transport exploded" });
  expect(seen).toContainEqual({
    type: "turn-finished",
    chatKey: "relay:acct-1",
    sessionAlias: "backend",
    ok: false,
    errorMessage: "transport exploded",
  });
});

test("executeCommand concatenates reply chunks and final text", async () => {
  const { control } = makeControl(async (request) => {
    expect(request.text).toBe("/status");
    await request.reply?.("part-1");
    await request.reply?.("part-2");
    return { text: "tail" };
  });
  const output = await control.executeCommand({
    chatKey: "relay:acct-1",
    text: "/status",
    senderId: "acct-1",
  });
  expect(output).toBe("part-1\npart-2\ntail");
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `bun test tests/unit/control/control-service-prompt.test.ts`
Expected: FAIL（方法不存在）。

- [ ] **Step 3: 实现**

类型与字段（追加到 control-service.ts）：

```ts
export interface ControlPromptInput {
  chatKey: string;
  sessionAlias: string;
  text: string;
  accountId?: string;
  senderId: string;
  isOwner?: boolean;
}

export interface ControlPromptResult {
  ok: boolean;
  text?: string;
  errorMessage?: string;
}

export interface ControlExecuteCommandInput {
  chatKey: string;
  text: string;
  accountId?: string;
  senderId: string;
  isOwner?: boolean;
}
```

类内：

```ts
  private readonly inFlight = new Map<string, AbortController>();

  async prompt(input: ControlPromptInput): Promise<ControlPromptResult> {
    const key = turnKey(input.chatKey, input.sessionAlias);
    if (this.inFlight.has(key)) {
      return { ok: false, errorMessage: "turn-already-running" };
    }
    try {
      await this.deps.sessions.useSession(input.chatKey, input.sessionAlias);
    } catch (error) {
      return { ok: false, errorMessage: toErrorMessage(error) };
    }
    const controller = new AbortController();
    this.inFlight.set(key, controller);
    const emitChunk = (chunk: string) => {
      this.deps.events.emit({
        type: "turn-output",
        chatKey: input.chatKey,
        sessionAlias: input.sessionAlias,
        chunk,
      });
    };
    try {
      const response = await this.deps.agent.chat({
        accountId: input.accountId ?? "control",
        conversationId: input.chatKey,
        text: input.text,
        metadata: {
          channel: "control",
          chatType: "direct",
          senderId: input.senderId,
          isOwner: input.isOwner,
        },
        abortSignal: controller.signal,
        reply: async (chunk) => {
          emitChunk(chunk);
        },
      });
      if (response.text) {
        emitChunk(response.text);
      }
      this.deps.events.emit({
        type: "turn-finished",
        chatKey: input.chatKey,
        sessionAlias: input.sessionAlias,
        ok: true,
      });
      return { ok: true, text: response.text };
    } catch (error) {
      const errorMessage = toErrorMessage(error);
      this.deps.events.emit({
        type: "turn-finished",
        chatKey: input.chatKey,
        sessionAlias: input.sessionAlias,
        ok: false,
        errorMessage,
      });
      return { ok: false, errorMessage };
    } finally {
      this.inFlight.delete(key);
    }
  }

  cancelTurn(chatKey: string, sessionAlias: string): boolean {
    const controller = this.inFlight.get(turnKey(chatKey, sessionAlias));
    if (!controller) {
      return false;
    }
    controller.abort();
    return true;
  }

  async executeCommand(input: ControlExecuteCommandInput): Promise<string> {
    const chunks: string[] = [];
    const response = await this.deps.agent.chat({
      accountId: input.accountId ?? "control",
      conversationId: input.chatKey,
      text: input.text,
      metadata: {
        channel: "control",
        chatType: "direct",
        senderId: input.senderId,
        isOwner: input.isOwner,
      },
      reply: async (chunk) => {
        chunks.push(chunk);
      },
    });
    if (response.text) {
      chunks.push(response.text);
    }
    return chunks.join("\n");
  }
```

模块底部辅助函数：

```ts
function turnKey(chatKey: string, sessionAlias: string): string {
  return `${chatKey} ${sessionAlias}`;
}

function toErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
```

注意：`isOwner` 为 `undefined` 时测试期望 metadata 不含该键——若 `toEqual` 因 `isOwner: undefined` 失败，改为条件展开 `...(input.isOwner === undefined ? {} : { isOwner: input.isOwner })`。

- [ ] **Step 4: 跑测试确认通过**

Run: `bun test tests/unit/control/control-service-prompt.test.ts && node ./scripts/run-tests.mjs tests/unit/control`
Expected: 全部 PASS。

- [ ] **Step 5: Commit**

```bash
git add src/control/control-service.ts tests/unit/control/control-service-prompt.test.ts
git commit -m "feat(control): prompt streaming, turn cancellation, and executeCommand"
```

---

### Task 10: 装配——buildApp / AppRuntime / ChannelStartInput / plugin-api

**Files:**
- Modify: `src/main.ts`
- Modify: `src/channels/types.ts`
- Modify: `src/run-console.ts`
- Modify: `src/plugin-api.ts`
- Test: `tests/unit/run-console.test.ts`（追加用例 + 更新 createRuntime helper）

- [ ] **Step 1: 在 run-console.test.ts 追加失败用例**

先 Read 该文件顶部的 `createRuntime()` helper，给它补 `control: {} as never`（AppRuntime 即将新增必选字段）。然后追加（仿 :206 的测试骨架）：

```ts
test("passes the control facade through to channel startup", async () => {
  const signalHandlers = new Map<string, () => void>();
  let startInput: { control?: unknown } | undefined;

  const runPromise = runConsole(
    { configPath: "/cfg", statePath: "/state" },
    {
      buildApp: async () => ({
        ...createRuntime(),
        control: { marker: "control-facade" } as never,
      }),
      channels: {
        startAll: async (input) => {
          startInput = input as { control?: unknown };
        },
      },
      addProcessListener: (signal, handler) => {
        signalHandlers.set(signal, handler);
      },
      removeProcessListener: () => {},
    },
  );

  await new Promise((resolve) => setTimeout(resolve, 10));
  expect(startInput?.control).toEqual({ marker: "control-facade" });

  signalHandlers.get("SIGTERM")?.();
  await runPromise;
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `bun test tests/unit/run-console.test.ts`
Expected: 新用例 FAIL（`startInput.control` 为 undefined）。

- [ ] **Step 3: 改 src/channels/types.ts**

`ChannelStartInput` 追加（import 放文件顶部，**从 control 模块导入，不要让 control-service 反向 import channels/types**，避免循环）：

```ts
import type { ControlService } from "../control/control-service.js";
```

```ts
  /**
   * Structured control facade (sessions / prompt / scheduler / orchestration)
   * for structured consumers such as the relay connector. Optional: text-only
   * channels ignore it.
   */
  control?: ControlService;
```

- [ ] **Step 4: 改 src/main.ts**

imports 区追加：

```ts
import { createControlEventBus } from "./control/control-event-bus";
import { ControlService } from "./control/control-service";
```

`AppRuntime` 接口（:60-88）追加一行：

```ts
  control: ControlService;
```

`const agent = new ConsoleAgent(router, logger)`（约 :758）之后追加：

```ts
  const controlEvents = createControlEventBus(logger);
  const control = new ControlService({
    agent,
    sessions,
    activeTurns,
    scheduled: scheduledService,
    orchestration,
    events: controlEvents,
  });
```

buildApp 返回对象（:810 起）追加 `control,`。

- [ ] **Step 5: 改 src/run-console.ts**

`startAll({...})`（:186-197）追加一行：

```ts
      control: runtime.control,
```

- [ ] **Step 6: 改 src/plugin-api.ts**

追加导出：

```ts
export type {
  ControlExecuteCommandInput,
  ControlPromptInput,
  ControlPromptResult,
  ControlService,
  ControlSessionInfo,
} from "./control/control-service.js";
export type { ControlEvent, ControlEventBus, ControlEventListener } from "./control/control-event-bus.js";
```

- [ ] **Step 7: 类型检查 + 全量单测**

Run: `npx tsc --noEmit`
Expected: 无报错。若有其它伪造 AppRuntime 的测试 helper 缺 `control` 字段，逐个补 `control: {} as never`。

Run: `npm test`
Expected: 全部 PASS（脚本会先 tsc 再逐文件跑 tests/unit）。

- [ ] **Step 8: Commit**

```bash
git add src/main.ts src/channels/types.ts src/run-console.ts src/plugin-api.ts tests/unit/run-console.test.ts
git commit -m "feat(control): wire ControlService into buildApp and ChannelStartInput"
```

---

### Task 11: 文档

**Files:**
- Create: `docs/control-module.md`
- Modify: `AGENTS.md`（只改 AGENTS.md，CLAUDE.md 是符号链接）

- [ ] **Step 1: 写 docs/control-module.md**

内容骨架（用实际落地的 API 充实，保持与代码一致；中文，风格仿 docs/daemon-module.md）：

```markdown
# src/control 模块说明（Control API）

ControlService 是面向结构化消费者（首个是 relay 连接器，见
docs/superpowers/specs/2026-06-13-relay-hub-design.md）的核心控制门面，
聚合 SessionService / ActiveTurnRegistry / ScheduledTaskService /
OrchestrationService / ConsoleAgent，自身无持久状态。

## 文件
- `src/control/control-service.ts` — 门面：sessions / prompt / scheduler /
  orchestration / executeCommand 五个域。
- `src/control/control-event-bus.ts` — ControlEventBus：turn-output /
  turn-finished / sessions-changed / scheduled-changed / orchestration-changed
  事件；监听器异常彼此隔离。

## 注入方式
buildApp 构造后挂在 `AppRuntime.control`，经 `ChannelStartInput.control`
（可选字段）传给频道；纯文本频道可忽略。插件经 `xacpx/plugin-api` 取类型。

## 语义要点
- `prompt` 会先 `useSession(chatKey, alias)` 再走 ConsoleAgent，同一
  (chatKey, alias) 同时只允许一个 in-flight turn；`cancelTurn` 经
  AbortController 中止。
- metadata 固定 `channel: "control"`、`chatType: "direct"`；`senderId` /
  `isOwner` 由调用方提供（满足 fail-closed 路由契约）。
- 事件总线只保证「ControlService 自身发起的变更」会发事件；其它入口
  （如微信命令）造成的变更暂不发事件，消费者需按需拉快照。

## 关联包
- `packages/relay-protocol` — relay 线协议（信封 + wire DTO），零依赖、
  不 import xacpx；core↔wire 的映射放在阶段二的连接器里。
```

- [ ] **Step 2: AGENTS.md 导航补两行**

在 "Docs to rely on" 列表中追加：

```markdown
- Control API（结构化控制面）: [`docs/control-module.md`](docs/control-module.md)
```

- [ ] **Step 3: 验证 + Commit**

Run: `npx tsc --noEmit`（确认没顺手改坏什么）

```bash
git add docs/control-module.md AGENTS.md
git commit -m "docs: add control module notes and AGENTS.md navigation"
```

---

## Self-Review 结论（已执行）

- **Spec 覆盖**：spec §4.1（ControlService 五个域 + 事件总线 + ChannelStartInput 注入）→ Task 5-10；§4.2（信封、版本校验、零依赖）→ Task 1-3；DTO 命名空间拆分（instance/frontend 报文类型）按 spec 属阶段二连接器/服务端，本阶段只落信封 + 数据 DTO，已在 Task 3 说明。
- **占位符**：无 TBD；两处「按实际确认」是对既有代码字段名的核验指令（ResolvedSession 字段、AppLogger.warn 签名、OrchestrationSourceKind 合法值），均给出了文件位置与预期值。
- **类型一致性**：`ControlService` 方法名在 Task 6-10 与测试间一致（listSessions/createSession/removeSession/listScheduledTasks/createScheduledTask/cancelScheduledTask/listOrchestrationTasks/getOrchestrationTask/cancelOrchestrationTask/prompt/cancelTurn/executeCommand）；`ControlEvent` 五个变体在 bus、service、DTO（ControlEventDto）三处字段一致。
