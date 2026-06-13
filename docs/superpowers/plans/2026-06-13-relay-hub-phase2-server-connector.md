# Relay Hub 阶段二：relay 服务端 + channel-relay 连接器 实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 落地 relay hub 的服务端与 xacpx 侧连接器（spec: `docs/superpowers/specs/2026-06-13-relay-hub-design.md` §4.3/§4.4/§5/§6/§7），实现「配对 → 实例外联注册 → 经 relay 代理调用 ControlService」的端到端链路。

**Architecture:** `packages/relay` 是独立部署的 hub：SQLite（账号/邀请/实例/配对 token/登录态）+ Hono HTTP API（登录、邀请、实例管理、RPC 代理）+ `ws` 实例网关（注册/认证/请求关联/事件接收）。`packages/channel-relay` 是 xacpx 频道插件：WS 外联 + 首连配对换凭证（凭证存本机状态文件）+ 把 relay 的 RPC 请求分发到阶段一的 `ControlService` 并把 `ControlEventBus` 事件回传。协议消息类型补进 `packages/relay-protocol`。

**Tech Stack:** TypeScript + Bun（构建/测试）。新依赖：`hono` + `@hono/node-server`（relay HTTP）；`ws`（根依赖已有 ^8.20.0）。SQLite 经 `SqlDriver` 适配层：Bun 运行时用 `bun:sqlite`，Node 用 `node:sqlite`（已验证 Node v24 可用、Bun 1.3.14 下 `node:sqlite` 不可用、`ws` 服务端在 bun test 下可用）。密码哈希用 `node:crypto` scrypt。

**与 spec 的三处偏差（本计划末尾任务会修订 spec）：**
1. **配对 CLI**：核心 CLI 是封闭 switch，插件无法注册 `xacpx relay connect` 顶级命令（已核实 src/cli.ts:292-521）。改为 `xacpx channel add relay --url <wss-url> --token <pairing-token>`；配对交换发生在**首次运行时连接**：连接器用 pairing token 注册 → relay 换发长期凭证 → 连接器写入 `coreHomeDir()/relay/credential.json`（weixin 频道的凭证先例：动态凭证存状态文件、不进 config.json）。
2. **密码哈希**：argon2 是原生模块（增加部署摩擦），改用 `node:crypto` scrypt（内置、零依赖、OWASP 认可），格式自带参数可未来迁移。
3. **端口**：HTTP API 与实例 WS 分开两个端口（默认 8787/8788），不共用一个端口做 upgrade（Bun 的 node:http upgrade 兼容性不确定，分端口可全程在 bun test 下验证）。

**分支策略：** 阶段一在未合并分支 `feat/relay-hub-phase1-control-api`（HEAD `493ae73`）上。本阶段**从该分支创建堆叠分支** `feat/relay-hub-phase2-server-connector`（依赖 src/control 与 relay-protocol）。

**执行注意（来自仓库经验）：**
- 跑测试用 `node ./scripts/run-tests.mjs <dir>` 或逐文件 `bun test <file>`；**不要**整目录 `bun test`（模块状态泄漏假失败）。
- **bun.lock 在 Task 2 会合法变更一次**（新增 workspace 包及 hono 依赖），那一次连同 package.json 一起提交；其它任务一律不得动 lockfile。
- 不要动 `CLAUDE.md`（`AGENTS.md` 的符号链接）。不要 push/rebase/切别的分支。每任务一个 commit。
- 本机 shell hook 可能打乱 shell 读文件输出；读源码用 Read 工具。

---

## File Structure

```
packages/relay-protocol/src/
└── messages.ts                  # 新建：MSG 类型常量 + 各 RPC/事件 payload 类型 + ErrorPayload

packages/relay/                  # 新建整包（独立部署的 hub 服务）
├── package.json                 # bin: xacpx-relay；deps: hono/@hono/node-server/ws/relay-protocol
├── tsconfig.json
├── README.md
└── src/
    ├── db.ts                    # SqlDriver 适配层（bun:sqlite / node:sqlite）+ schema
    ├── auth.ts                  # scrypt 哈希/校验 + token 生成/哈希
    ├── stores/accounts.ts       # 账号 / 邀请 / web 登录态
    ├── stores/instances.ts      # 配对 token / 实例（凭证、last_seen）
    ├── gateway/instance-gateway.ts  # 实例 WS 网关：注册/认证/req-res 关联/事件
    ├── http/app.ts              # Hono API：login/invites/register/instances/rpc 代理
    ├── server.ts                # createRelayRuntime（可测组装）+ startRelayServer（真监听）
    └── cli.ts                   # xacpx-relay start | init-admin | token new

packages/channel-relay/          # 新建整包（xacpx 频道插件，feishu 模式）
├── package.json                 # peerDep xacpx；deps: ws/relay-protocol
├── tsconfig.json                # paths: xacpx/plugin-api → dist/plugin-api（feishu 同款）
├── README.md
└── src/
    ├── config.ts                # 解析 channels[].options（url/pairingToken/name）
    ├── credential-store.ts      # coreHomeDir()/relay/credential.json 读写
    ├── relay-client.ts          # WS 客户端：握手（register|auth）/重连退避/req 分发
    ├── control-bridge.ts        # RPC→ControlService 分发 + record→DTO 映射 + 事件转发
    ├── channel.ts               # RelayChannel implements MessageChannelRuntime
    ├── relay-provider.ts        # cliProvider：channel add relay --url --token
    └── index.ts                 # XacpxPlugin 入口

修改：
- src/plugin-api.ts              # 导出 coreHomeDir（连接器凭证文件定位）
- package.json（根）             # build:relay / build:channel-relay / clean 脚本 + build:packages
- scripts/run-tests.mjs          # 预构建追加 relay-protocol dist（包消费方测试需要）
- docs/superpowers/specs/2026-06-13-relay-hub-design.md  # 三处偏差修订
- AGENTS.md                      # 导航补 docs/relay-module.md

测试（均在 tests/unit/packages/ 下）：
- relay-protocol/messages.test.ts
- relay/{db,auth,stores-accounts,stores-instances,gateway,http-app,cli}.test.ts
- relay/integration.test.ts      # 端到端：配对→认证→RPC 往返
- channel-relay/{config,credential-store,relay-client,control-bridge,channel,provider}.test.ts

文档：
- docs/relay-module.md           # 服务端部署/配对/连接器使用说明
```

**已核实的关键接口（写代码时直接引用，不要再猜）：**
- `ChannelCliProvider`（src/channels/cli/provider.ts:1-73）：`type/displayName/supportsLogin/parseAddArgs/buildDefaultConfig/validateConfig/renderSummary/promptForMissingFields`；helper `takeFlagValue`/`parseBooleanFlag` 同文件导出，且 **plugin-api 已导出全部 ChannelCli\* 类型**。`channel add` 的 config 持久化由核心做（provider 只返回 `ChannelRuntimeConfig`）。
- `ChannelFactory = (options, deps?) => MessageChannelRuntime`（src/channels/create-channel.ts:21）；`options` 即 config.json `channels[].options`。
- 插件入口结构照抄 `packages/channel-feishu/src/index.ts`（XacpxPlugin，channels[{type, factory, cliProvider}]）。
- `ChannelStartInput.control?: ControlService`（阶段一已加）；`ControlService`/`ControlEvent` 等类型已从 `xacpx/plugin-api` 导出。
- `coreHomeDir` 在 `src/runtime/core-home.ts`（main.ts:6 import 它）——Task 10 先 Read 确认签名再加 plugin-api 导出。
- run-tests.mjs 预构建插桩点：`scripts/run-tests.mjs:15-27`（plugin-api bun build 之后、`buildTestPlan` 之前）。
- 频道 `start(input)` 的生命周期约定：阻塞至 `input.abortSignal` 触发（run-console.test.ts:234 的既有行为）。

---

### Task 1: 堆叠分支 + relay-protocol 消息类型（TDD）

**Files:**
- Create: `packages/relay-protocol/src/messages.ts`
- Modify: `packages/relay-protocol/src/index.ts`
- Test: `tests/unit/packages/relay-protocol/messages.test.ts`

- [ ] **Step 1: 创建堆叠分支**

```bash
git checkout feat/relay-hub-phase1-control-api
git checkout -b feat/relay-hub-phase2-server-connector
git log --oneline -1   # 应为 493ae73 docs: add control module notes...
```

- [ ] **Step 2: 写失败测试**

```ts
import { expect, test } from "bun:test";

import {
  MSG,
  errorPayload,
  isErrorPayload,
} from "../../../../packages/relay-protocol/src/messages";

test("message type constants are namespaced and unique", () => {
  const values = Object.values(MSG);
  expect(new Set(values).size).toBe(values.length);
  for (const value of values) {
    expect(value).toMatch(/^(instance|control)\.[a-z.]+$/);
  }
});

test("errorPayload/isErrorPayload roundtrip", () => {
  const payload = errorPayload("instance-offline", "instance i-1 is not connected");
  expect(isErrorPayload(payload)).toBe(true);
  expect(payload.error.code).toBe("instance-offline");
  expect(isErrorPayload({ ok: true })).toBe(false);
  expect(isErrorPayload(null)).toBe(false);
  expect(isErrorPayload({ error: { code: 1, message: "x" } })).toBe(false);
});
```

- [ ] **Step 3: 跑测试确认失败**

Run: `bun test tests/unit/packages/relay-protocol/messages.test.ts`
Expected: FAIL（模块不存在）。

- [ ] **Step 4: 实现 messages.ts**

```ts
import type { ControlEventDto, OrchestrationTaskDto, ScheduledTaskDto, SessionDto } from "./dtos.js";

// Instance <-> relay message types. Convention: chatKey for relay-driven chats
// is `relay:<accountId>`; the relay server stamps chatKey/senderId/isOwner on
// chat-scoped requests server-side (clients cannot forge them).
export const MSG = {
  instanceRegister: "instance.register",
  instanceAuth: "instance.auth",
  instanceEvent: "instance.event",
  instanceNotice: "instance.notice",
  sessionsList: "control.sessions.list",
  sessionsCreate: "control.sessions.create",
  sessionsRemove: "control.sessions.remove",
  prompt: "control.prompt",
  promptCancel: "control.prompt.cancel",
  commandExecute: "control.command.execute",
  scheduledList: "control.scheduled.list",
  scheduledCreate: "control.scheduled.create",
  scheduledCancel: "control.scheduled.cancel",
  orchestrationList: "control.orchestration.list",
  orchestrationGet: "control.orchestration.get",
  orchestrationCancel: "control.orchestration.cancel",
} as const;

export type MessageType = (typeof MSG)[keyof typeof MSG];

export interface ErrorPayload {
  error: { code: string; message: string };
}

export function errorPayload(code: string, message: string): ErrorPayload {
  return { error: { code, message } };
}

export function isErrorPayload(payload: unknown): payload is ErrorPayload {
  if (typeof payload !== "object" || payload === null) return false;
  const candidate = (payload as Record<string, unknown>).error;
  if (typeof candidate !== "object" || candidate === null) return false;
  const error = candidate as Record<string, unknown>;
  return typeof error.code === "string" && typeof error.message === "string";
}

// --- handshake ---
export interface InstanceRegisterPayload {
  pairingToken: string;
  name?: string;
  coreVersion?: string;
}
export interface InstanceRegisterResult {
  instanceId: string;
  credential: string;
}
export interface InstanceAuthPayload {
  instanceId: string;
  credential: string;
  coreVersion?: string;
}
export interface InstanceAuthResult {
  ok: true;
}

// --- instance push ---
export interface InstanceEventPayload {
  event: ControlEventDto;
}
export interface InstanceNoticePayload {
  kind: "task-completion" | "task-progress" | "coordinator-message";
  text: string;
  taskId?: string;
  chatKey?: string;
}

// --- control RPCs (relay -> instance req; instance res) ---
export interface SessionsListResult {
  sessions: SessionDto[];
}
export interface SessionsCreatePayload {
  alias: string;
  agent: string;
  workspace: string;
}
export interface SessionsRemovePayload {
  alias: string;
}
export interface PromptPayload {
  chatKey: string;
  sessionAlias: string;
  text: string;
  senderId: string;
  isOwner?: boolean;
}
export interface PromptResultPayload {
  ok: boolean;
  text?: string;
  errorMessage?: string;
}
export interface PromptCancelPayload {
  chatKey: string;
  sessionAlias: string;
}
export interface PromptCancelResult {
  cancelled: boolean;
}
export interface CommandExecutePayload {
  chatKey: string;
  text: string;
  senderId: string;
  isOwner?: boolean;
}
export interface CommandExecuteResult {
  output: string;
}
export interface ScheduledListPayload {
  chatKey: string;
}
export interface ScheduledListResult {
  tasks: ScheduledTaskDto[];
}
export interface ScheduledCreatePayload {
  chatKey: string;
  sessionAlias: string;
  /** ISO timestamp. */
  executeAt: string;
  message: string;
}
export interface ScheduledCancelPayload {
  id: string;
  chatKey: string;
}
export interface ScheduledCancelResult {
  cancelled: boolean;
}
export interface OrchestrationListResult {
  tasks: OrchestrationTaskDto[];
}
export interface OrchestrationGetPayload {
  taskId: string;
}
export interface OrchestrationGetResult {
  task: OrchestrationTaskDto | null;
}
export interface OrchestrationCancelPayload {
  taskId: string;
}
```

`src/index.ts` 追加一行：`export * from "./messages.js";`

- [ ] **Step 5: 跑测试 + 构建确认通过**

Run: `bun test tests/unit/packages/relay-protocol/messages.test.ts && bun run build:relay-protocol && npx tsc --noEmit`
Expected: 全部 PASS，构建出 dist/messages.d.ts。

- [ ] **Step 6: Commit**

```bash
git add packages/relay-protocol/src tests/unit/packages/relay-protocol
git commit -m "feat(relay-protocol): instance/control message types and error payload"
```

---

### Task 2: packages/relay 脚手架 + 依赖安装 + run-tests 预构建

**Files:**
- Create: `packages/relay/package.json`、`packages/relay/tsconfig.json`、`packages/relay/README.md`、`packages/relay/src/cli.ts`（占位）
- Modify: `package.json`（根）、`scripts/run-tests.mjs`

- [ ] **Step 1: 创建 packages/relay/package.json**

```json
{
  "name": "@ganglion/xacpx-relay",
  "version": "0.1.0",
  "description": "Self-hosted relay hub for xacpx: instance gateway, accounts, and web API.",
  "license": "MIT",
  "keywords": ["xacpx", "relay", "hub"],
  "repository": {
    "type": "git",
    "url": "git+https://github.com/gadzan/xacpx.git",
    "directory": "packages/relay"
  },
  "type": "module",
  "main": "./dist/cli.js",
  "bin": { "xacpx-relay": "./dist/cli.js" },
  "files": ["dist", "README.md"],
  "engines": { "node": ">=22.13.0" },
  "publishConfig": { "access": "public" },
  "dependencies": {
    "@ganglion/xacpx-relay-protocol": "^0.1.0",
    "@hono/node-server": "^1.13.0",
    "hono": "^4.6.0",
    "ws": "^8.20.0"
  }
}
```

（engines 取 `node:sqlite` 可用线；Bun ≥1.2 运行时经 `bun:sqlite` 适配层同样支持，README 说明。）

- [ ] **Step 2: 创建 tsconfig.json**（同 relay-protocol：extends 根、declarationOnly、无 paths——`@ganglion/xacpx-relay-protocol` 经 workspace node_modules 链接解析到 dist）

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

- [ ] **Step 3: 占位 src/cli.ts 与 README.md**

`src/cli.ts`：
```ts
export const RELAY_CLI_PLACEHOLDER = "implemented in later tasks";
```

`README.md`：
```markdown
# @ganglion/xacpx-relay

Self-hosted relay hub for xacpx. Multiple xacpx instances dial out to this
server over WebSocket; accounts log in over HTTP to manage and drive them.

Runtime: Node >= 22.13 (uses node:sqlite) or Bun >= 1.2 (uses bun:sqlite).
Two ports: HTTP API (default 8787) and instance WebSocket gateway (default 8788).

See `docs/relay-module.md` and the design spec
`docs/superpowers/specs/2026-06-13-relay-hub-design.md` in the repo root.
```

- [ ] **Step 4: 根 package.json 脚本 + 安装依赖**

仿现有 `clean:relay-protocol`/`build:relay-protocol` 风格新增（clean 用现有 `node -e rmSync` 写法）：

```json
"clean:relay": "node -e \"require('node:fs').rmSync('packages/relay/dist', { recursive: true, force: true })\"",
"build:relay": "bun run build:relay-protocol && bun run clean:relay && bun build ./packages/relay/src/cli.ts --outdir ./packages/relay/dist --target node --external ws --external hono --external @hono/node-server --external @ganglion/xacpx-relay-protocol && tsc -p packages/relay/tsconfig.json",
```

并把 `build:packages` 末尾追加 ` && bun run build:relay`。然后安装（**本任务唯一合法的 lockfile 变更**）：

Run: `bun install`
Expected: bun.lock 更新（新增 hono/@hono/node-server 与 relay 包条目）；`ls node_modules/@ganglion/xacpx-relay-protocol` 应是指向 packages/relay-protocol 的链接。

- [ ] **Step 5: scripts/run-tests.mjs 预构建追加 relay-protocol**

Read `scripts/run-tests.mjs:7-29`，在 plugin-api 的 `runOne("bun", ["build", ...])` 块之后、`buildTestPlan` 之前，追加同形态的一块：

```js
// relay/channel-relay tests import "@ganglion/xacpx-relay-protocol", which the
// workspace link resolves to packages/relay-protocol/dist — build it up front
// for the same order-independence reason as plugin-api above.
const protocolBuildCode = await runOne("bun", [
  "build",
  "./packages/relay-protocol/src/index.ts",
  "--outdir",
  "./packages/relay-protocol/dist",
  "--target",
  "node",
]);
if (protocolBuildCode !== 0) {
  process.exit(protocolBuildCode ?? 1);
}
```

- [ ] **Step 6: 验证**

Run: `bun run build:relay && npm test`
Expected: relay 构建出 dist/cli.js；全量单测仍绿（run-tests 预构建生效）。

- [ ] **Step 7: Commit**

```bash
git add packages/relay package.json bun.lock scripts/run-tests.mjs
git commit -m "feat(relay): scaffold relay hub package, deps, and test pre-build"
```

---

### Task 3: SqlDriver 适配层 + schema（TDD）

**Files:**
- Create: `packages/relay/src/db.ts`
- Test: `tests/unit/packages/relay/db.test.ts`

- [ ] **Step 1: 写失败测试**

```ts
import { expect, test } from "bun:test";

import { createSqlDriver, initSchema } from "../../../../packages/relay/src/db";

test("driver run/get/all/exec roundtrip on :memory:", async () => {
  const db = await createSqlDriver(":memory:");
  db.exec("CREATE TABLE t (id TEXT PRIMARY KEY, n INTEGER NOT NULL)");
  db.run("INSERT INTO t (id, n) VALUES (?, ?)", ["a", 1]);
  db.run("INSERT INTO t (id, n) VALUES (?, ?)", ["b", 2]);
  expect(db.get<{ n: number }>("SELECT n FROM t WHERE id = ?", ["a"])).toEqual({ n: 1 });
  expect(db.get("SELECT n FROM t WHERE id = ?", ["zz"])).toBeUndefined();
  expect(db.all<{ id: string }>("SELECT id FROM t ORDER BY id")).toEqual([{ id: "a" }, { id: "b" }]);
  db.close();
});

test("initSchema creates all tables idempotently", async () => {
  const db = await createSqlDriver(":memory:");
  initSchema(db);
  initSchema(db); // idempotent
  const tables = db
    .all<{ name: string }>("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name")
    .map((row) => row.name);
  for (const expected of ["accounts", "instances", "invites", "pairing_tokens", "web_sessions"]) {
    expect(tables).toContain(expected);
  }
  db.close();
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `bun test tests/unit/packages/relay/db.test.ts`
Expected: FAIL（模块不存在）。

- [ ] **Step 3: 实现 db.ts**

```ts
// Minimal SQLite adapter: bun:sqlite when running under Bun (tests, optional
// deployment), node:sqlite under Node (primary deployment). node:sqlite is NOT
// implemented by Bun 1.3, hence the runtime switch.
export interface SqlDriver {
  exec(sql: string): void;
  run(sql: string, params?: ReadonlyArray<string | number | null>): void;
  get<T>(sql: string, params?: ReadonlyArray<string | number | null>): T | undefined;
  all<T>(sql: string, params?: ReadonlyArray<string | number | null>): T[];
  close(): void;
}

type SqlParams = ReadonlyArray<string | number | null>;

export async function createSqlDriver(path: string): Promise<SqlDriver> {
  if (typeof Bun !== "undefined") {
    const { Database } = await import("bun:sqlite");
    const db = new Database(path);
    return {
      exec: (sql) => db.exec(sql),
      run: (sql, params: SqlParams = []) => {
        db.query(sql).run(...(params as (string | number | null)[]));
      },
      get: <T>(sql: string, params: SqlParams = []) =>
        (db.query(sql).get(...(params as (string | number | null)[])) ?? undefined) as T | undefined,
      all: <T>(sql: string, params: SqlParams = []) =>
        db.query(sql).all(...(params as (string | number | null)[])) as T[],
      close: () => db.close(),
    };
  }
  const { DatabaseSync } = await import("node:sqlite");
  const db = new DatabaseSync(path);
  return {
    exec: (sql) => db.exec(sql),
    run: (sql, params: SqlParams = []) => {
      db.prepare(sql).run(...(params as (string | number | null)[]));
    },
    get: <T>(sql: string, params: SqlParams = []) =>
      (db.prepare(sql).get(...(params as (string | number | null)[])) ?? undefined) as T | undefined,
    all: <T>(sql: string, params: SqlParams = []) =>
      db.prepare(sql).all(...(params as (string | number | null)[])) as T[],
    close: () => db.close(),
  };
}

export function initSchema(db: SqlDriver): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS accounts (
      id TEXT PRIMARY KEY,
      username TEXT NOT NULL UNIQUE,
      password_hash TEXT NOT NULL,
      role TEXT NOT NULL CHECK (role IN ('admin','member')),
      created_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS invites (
      token_hash TEXT PRIMARY KEY,
      created_by TEXT NOT NULL REFERENCES accounts(id),
      expires_at TEXT NOT NULL,
      used_by TEXT
    );
    CREATE TABLE IF NOT EXISTS web_sessions (
      token_hash TEXT PRIMARY KEY,
      account_id TEXT NOT NULL REFERENCES accounts(id),
      expires_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS pairing_tokens (
      token_hash TEXT PRIMARY KEY,
      account_id TEXT NOT NULL REFERENCES accounts(id),
      name TEXT,
      expires_at TEXT NOT NULL,
      used_at TEXT
    );
    CREATE TABLE IF NOT EXISTS instances (
      id TEXT PRIMARY KEY,
      account_id TEXT NOT NULL REFERENCES accounts(id),
      name TEXT NOT NULL,
      credential_hash TEXT NOT NULL,
      core_version TEXT,
      last_seen_at TEXT,
      created_at TEXT NOT NULL
    );
  `);
}
```

若 `tsc -p packages/relay/tsconfig.json` 无法解析 `node:sqlite` 类型（bun-types 不含时），新建 `packages/relay/src/node-sqlite.d.ts`：

```ts
declare module "node:sqlite" {
  export class DatabaseSync {
    constructor(path: string);
    exec(sql: string): void;
    prepare(sql: string): {
      run(...params: Array<string | number | null>): unknown;
      get(...params: Array<string | number | null>): unknown;
      all(...params: Array<string | number | null>): unknown[];
    };
    close(): void;
  }
}
```

- [ ] **Step 4: 跑测试 + 包 typecheck 确认通过**

Run: `bun test tests/unit/packages/relay/db.test.ts && bun run build:relay`
Expected: 2 PASS；构建（含 tsc -p）无错。

- [ ] **Step 5: Commit**

```bash
git add packages/relay/src tests/unit/packages/relay
git commit -m "feat(relay): SqlDriver adapter (bun/node sqlite) and schema"
```

---

### Task 4: auth.ts — scrypt 密码哈希 + token 工具（TDD）

**Files:**
- Create: `packages/relay/src/auth.ts`
- Test: `tests/unit/packages/relay/auth.test.ts`

- [ ] **Step 1: 写失败测试**

```ts
import { expect, test } from "bun:test";

import { generateToken, hashPassword, hashToken, verifyPassword } from "../../../../packages/relay/src/auth";

test("password hash verifies and rejects wrong password", () => {
  const stored = hashPassword("hunter2");
  expect(stored.startsWith("scrypt:")).toBe(true);
  expect(verifyPassword("hunter2", stored)).toBe(true);
  expect(verifyPassword("hunter3", stored)).toBe(false);
});

test("same password hashes differently (random salt)", () => {
  expect(hashPassword("x")).not.toBe(hashPassword("x"));
});

test("verifyPassword rejects malformed stored values", () => {
  expect(verifyPassword("x", "")).toBe(false);
  expect(verifyPassword("x", "argon2:whatever")).toBe(false);
  expect(verifyPassword("x", "scrypt:bad")).toBe(false);
});

test("tokens are url-safe, unique, and hash deterministically", () => {
  const a = generateToken();
  const b = generateToken();
  expect(a).not.toBe(b);
  expect(a).toMatch(/^[A-Za-z0-9_-]{40,}$/);
  expect(hashToken(a)).toBe(hashToken(a));
  expect(hashToken(a)).not.toBe(hashToken(b));
  expect(hashToken(a)).toMatch(/^[0-9a-f]{64}$/);
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `bun test tests/unit/packages/relay/auth.test.ts`
Expected: FAIL（模块不存在）。

- [ ] **Step 3: 实现 auth.ts**

```ts
import { createHash, randomBytes, scryptSync, timingSafeEqual } from "node:crypto";

// scrypt over argon2: built into node:crypto (zero native deps for a
// self-hosted server). Format embeds parameters for future migration:
// scrypt:<N>:<r>:<p>:<salt-b64url>:<key-b64url>
const SCRYPT_N = 16384;
const SCRYPT_R = 8;
const SCRYPT_P = 1;
const KEY_LENGTH = 32;

export function hashPassword(password: string): string {
  const salt = randomBytes(16);
  const key = scryptSync(password, salt, KEY_LENGTH, { N: SCRYPT_N, r: SCRYPT_R, p: SCRYPT_P });
  return `scrypt:${SCRYPT_N}:${SCRYPT_R}:${SCRYPT_P}:${salt.toString("base64url")}:${key.toString("base64url")}`;
}

export function verifyPassword(password: string, stored: string): boolean {
  const parts = stored.split(":");
  if (parts.length !== 6 || parts[0] !== "scrypt") return false;
  const n = Number(parts[1]);
  const r = Number(parts[2]);
  const p = Number(parts[3]);
  if (!Number.isInteger(n) || !Number.isInteger(r) || !Number.isInteger(p)) return false;
  let salt: Buffer;
  let expected: Buffer;
  try {
    salt = Buffer.from(parts[4] ?? "", "base64url");
    expected = Buffer.from(parts[5] ?? "", "base64url");
  } catch {
    return false;
  }
  if (salt.length === 0 || expected.length === 0) return false;
  const actual = scryptSync(password, salt, expected.length, { N: n, r, p });
  return timingSafeEqual(actual, expected);
}

/** 32 random bytes, base64url — used for invites, pairing tokens, credentials, web sessions. */
export function generateToken(): string {
  return randomBytes(32).toString("base64url");
}

/** Tokens are stored hashed at rest; sha256 suffices for high-entropy random tokens. */
export function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}
```

- [ ] **Step 4: 跑测试确认通过**

Run: `bun test tests/unit/packages/relay/auth.test.ts && bun run build:relay`
Expected: 4 PASS。

- [ ] **Step 5: Commit**

```bash
git add packages/relay/src/auth.ts tests/unit/packages/relay/auth.test.ts
git commit -m "feat(relay): scrypt password hashing and token utilities"
```

---

### Task 5: stores/accounts.ts — 账号/邀请/登录态（TDD）

**Files:**
- Create: `packages/relay/src/stores/accounts.ts`
- Test: `tests/unit/packages/relay/stores-accounts.test.ts`

- [ ] **Step 1: 写失败测试**

```ts
import { expect, test } from "bun:test";

import { createSqlDriver, initSchema } from "../../../../packages/relay/src/db";
import { AccountStore } from "../../../../packages/relay/src/stores/accounts";

async function makeStore(nowIso = "2026-06-13T10:00:00.000Z") {
  const db = await createSqlDriver(":memory:");
  initSchema(db);
  let now = new Date(nowIso);
  const store = new AccountStore(db, { now: () => now });
  return { store, setNow: (iso: string) => { now = new Date(iso); } };
}

test("createAccount + verifyLogin happy/sad paths", async () => {
  const { store } = await makeStore();
  const admin = store.createAccount("admin", "pw-1", "admin");
  expect(admin.role).toBe("admin");
  expect(store.verifyLogin("admin", "pw-1")?.id).toBe(admin.id);
  expect(store.verifyLogin("admin", "wrong")).toBeNull();
  expect(store.verifyLogin("ghost", "pw-1")).toBeNull();
  expect(() => store.createAccount("admin", "pw-2", "member")).toThrow();
});

test("invite lifecycle: validate, single-use, expiry", async () => {
  const { store, setNow } = await makeStore();
  const admin = store.createAccount("admin", "pw", "admin");
  const invite = store.createInvite(admin.id, 60_000);
  expect(store.validateInvite(invite.token)).toBe(true);
  const member = store.createAccount("alice", "pw", "member");
  store.markInviteUsed(invite.token, member.id);
  expect(store.validateInvite(invite.token)).toBe(false); // single-use

  const expiring = store.createInvite(admin.id, 60_000);
  setNow("2026-06-13T10:02:00.000Z");
  expect(store.validateInvite(expiring.token)).toBe(false); // expired
});

test("web session create/get/expire/delete", async () => {
  const { store, setNow } = await makeStore();
  const account = store.createAccount("admin", "pw", "admin");
  const token = store.createWebSession(account.id, 60_000);
  expect(store.getSessionAccount(token)?.username).toBe("admin");
  expect(store.getSessionAccount("nope")).toBeNull();
  setNow("2026-06-13T10:02:00.000Z");
  expect(store.getSessionAccount(token)).toBeNull(); // expired
  const token2 = store.createWebSession(account.id, 60_000);
  store.deleteWebSession(token2);
  expect(store.getSessionAccount(token2)).toBeNull();
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `bun test tests/unit/packages/relay/stores-accounts.test.ts`
Expected: FAIL。

- [ ] **Step 3: 实现 stores/accounts.ts**

```ts
import { randomUUID } from "node:crypto";

import { generateToken, hashPassword, hashToken, verifyPassword } from "../auth.js";
import type { SqlDriver } from "../db.js";

export type AccountRole = "admin" | "member";

export interface AccountRow {
  id: string;
  username: string;
  role: AccountRole;
  createdAt: string;
}

interface AccountStoreOptions {
  now?: () => Date;
}

export class AccountStore {
  private readonly now: () => Date;

  constructor(private readonly db: SqlDriver, options: AccountStoreOptions = {}) {
    this.now = options.now ?? (() => new Date());
  }

  createAccount(username: string, password: string, role: AccountRole): AccountRow {
    const id = randomUUID();
    const createdAt = this.now().toISOString();
    this.db.run(
      "INSERT INTO accounts (id, username, password_hash, role, created_at) VALUES (?, ?, ?, ?, ?)",
      [id, username, hashPassword(password), role, createdAt],
    );
    return { id, username, role, createdAt };
  }

  findByUsername(username: string): AccountRow | null {
    const row = this.db.get<{ id: string; username: string; role: AccountRole; created_at: string }>(
      "SELECT id, username, role, created_at FROM accounts WHERE username = ?",
      [username],
    );
    return row ? { id: row.id, username: row.username, role: row.role, createdAt: row.created_at } : null;
  }

  findById(id: string): AccountRow | null {
    const row = this.db.get<{ id: string; username: string; role: AccountRole; created_at: string }>(
      "SELECT id, username, role, created_at FROM accounts WHERE id = ?",
      [id],
    );
    return row ? { id: row.id, username: row.username, role: row.role, createdAt: row.created_at } : null;
  }

  verifyLogin(username: string, password: string): AccountRow | null {
    const row = this.db.get<{ id: string; username: string; password_hash: string; role: AccountRole; created_at: string }>(
      "SELECT id, username, password_hash, role, created_at FROM accounts WHERE username = ?",
      [username],
    );
    if (!row || !verifyPassword(password, row.password_hash)) return null;
    return { id: row.id, username: row.username, role: row.role, createdAt: row.created_at };
  }

  createInvite(createdByAccountId: string, ttlMs: number): { token: string; expiresAt: string } {
    const token = generateToken();
    const expiresAt = new Date(this.now().getTime() + ttlMs).toISOString();
    this.db.run(
      "INSERT INTO invites (token_hash, created_by, expires_at) VALUES (?, ?, ?)",
      [hashToken(token), createdByAccountId, expiresAt],
    );
    return { token, expiresAt };
  }

  validateInvite(token: string): boolean {
    const row = this.db.get<{ expires_at: string; used_by: string | null }>(
      "SELECT expires_at, used_by FROM invites WHERE token_hash = ?",
      [hashToken(token)],
    );
    if (!row || row.used_by !== null) return false;
    return new Date(row.expires_at).getTime() > this.now().getTime();
  }

  markInviteUsed(token: string, usedByAccountId: string): void {
    this.db.run("UPDATE invites SET used_by = ? WHERE token_hash = ?", [usedByAccountId, hashToken(token)]);
  }

  createWebSession(accountId: string, ttlMs: number): string {
    const token = generateToken();
    const expiresAt = new Date(this.now().getTime() + ttlMs).toISOString();
    this.db.run(
      "INSERT INTO web_sessions (token_hash, account_id, expires_at) VALUES (?, ?, ?)",
      [hashToken(token), accountId, expiresAt],
    );
    return token;
  }

  getSessionAccount(token: string): AccountRow | null {
    const row = this.db.get<{ account_id: string; expires_at: string }>(
      "SELECT account_id, expires_at FROM web_sessions WHERE token_hash = ?",
      [hashToken(token)],
    );
    if (!row || new Date(row.expires_at).getTime() <= this.now().getTime()) return null;
    return this.findById(row.account_id);
  }

  deleteWebSession(token: string): void {
    this.db.run("DELETE FROM web_sessions WHERE token_hash = ?", [hashToken(token)]);
  }
}
```

- [ ] **Step 4: 跑测试确认通过**

Run: `bun test tests/unit/packages/relay/stores-accounts.test.ts && bun run build:relay`
Expected: 3 PASS。

- [ ] **Step 5: Commit**

```bash
git add packages/relay/src/stores tests/unit/packages/relay/stores-accounts.test.ts
git commit -m "feat(relay): account, invite, and web-session store"
```

---

### Task 6: stores/instances.ts — 配对 token + 实例（TDD）

**Files:**
- Create: `packages/relay/src/stores/instances.ts`
- Test: `tests/unit/packages/relay/stores-instances.test.ts`

- [ ] **Step 1: 写失败测试**

```ts
import { expect, test } from "bun:test";

import { createSqlDriver, initSchema } from "../../../../packages/relay/src/db";
import { AccountStore } from "../../../../packages/relay/src/stores/accounts";
import { InstanceStore } from "../../../../packages/relay/src/stores/instances";

async function makeStores(nowIso = "2026-06-13T10:00:00.000Z") {
  const db = await createSqlDriver(":memory:");
  initSchema(db);
  let now = new Date(nowIso);
  const accounts = new AccountStore(db, { now: () => now });
  const instances = new InstanceStore(db, { now: () => now });
  const account = accounts.createAccount("alice", "pw", "member");
  return { instances, account, setNow: (iso: string) => { now = new Date(iso); } };
}

test("pairing token redeems once into an instance with a fresh credential", async () => {
  const { instances, account } = await makeStores();
  const issued = instances.issuePairingToken(account.id, "home-pc", 600_000);
  const redeemed = instances.redeemPairingToken(issued.token, "0.11.0");
  expect(redeemed).not.toBeNull();
  expect(redeemed?.accountId).toBe(account.id);
  expect(redeemed?.name).toBe("home-pc");
  expect(instances.redeemPairingToken(issued.token)).toBeNull(); // single-use

  const verified = instances.verifyCredential(redeemed!.instanceId, redeemed!.credential);
  expect(verified?.accountId).toBe(account.id);
  expect(instances.verifyCredential(redeemed!.instanceId, "wrong")).toBeNull();
  expect(instances.verifyCredential("ghost", redeemed!.credential)).toBeNull();
});

test("expired pairing token cannot be redeemed", async () => {
  const { instances, account, setNow } = await makeStores();
  const issued = instances.issuePairingToken(account.id, undefined, 60_000);
  setNow("2026-06-13T10:02:00.000Z");
  expect(instances.redeemPairingToken(issued.token)).toBeNull();
});

test("touch updates last_seen; listByAccount scopes; remove enforces ownership", async () => {
  const { instances, account, setNow } = await makeStores();
  const redeemed = instances.redeemPairingToken(
    instances.issuePairingToken(account.id, "pc", 600_000).token,
  )!;
  setNow("2026-06-13T10:05:00.000Z");
  instances.touch(redeemed.instanceId);
  const listed = instances.listByAccount(account.id);
  expect(listed).toHaveLength(1);
  expect(listed[0]?.lastSeenAt).toBe("2026-06-13T10:05:00.000Z");
  expect(instances.listByAccount("other-account")).toEqual([]);
  expect(instances.remove(redeemed.instanceId, "other-account")).toBe(false);
  expect(instances.remove(redeemed.instanceId, account.id)).toBe(true);
  expect(instances.listByAccount(account.id)).toEqual([]);
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `bun test tests/unit/packages/relay/stores-instances.test.ts`
Expected: FAIL。

- [ ] **Step 3: 实现 stores/instances.ts**

```ts
import { randomUUID } from "node:crypto";

import { generateToken, hashToken } from "../auth.js";
import type { SqlDriver } from "../db.js";

export interface InstanceRow {
  id: string;
  accountId: string;
  name: string;
  coreVersion: string | null;
  lastSeenAt: string | null;
  createdAt: string;
}

export interface RedeemedInstance {
  instanceId: string;
  credential: string;
  accountId: string;
  name: string;
}

interface InstanceStoreOptions {
  now?: () => Date;
}

export class InstanceStore {
  private readonly now: () => Date;

  constructor(private readonly db: SqlDriver, options: InstanceStoreOptions = {}) {
    this.now = options.now ?? (() => new Date());
  }

  issuePairingToken(accountId: string, name: string | undefined, ttlMs: number): { token: string; expiresAt: string } {
    const token = generateToken();
    const expiresAt = new Date(this.now().getTime() + ttlMs).toISOString();
    this.db.run(
      "INSERT INTO pairing_tokens (token_hash, account_id, name, expires_at) VALUES (?, ?, ?, ?)",
      [hashToken(token), accountId, name ?? null, expiresAt],
    );
    return { token, expiresAt };
  }

  /** Single-use: marks the token used and creates the instance row atomically-enough for our single-writer server. */
  redeemPairingToken(token: string, coreVersion?: string): RedeemedInstance | null {
    const tokenHash = hashToken(token);
    const row = this.db.get<{ account_id: string; name: string | null; expires_at: string; used_at: string | null }>(
      "SELECT account_id, name, expires_at, used_at FROM pairing_tokens WHERE token_hash = ?",
      [tokenHash],
    );
    const nowIso = this.now().toISOString();
    if (!row || row.used_at !== null || new Date(row.expires_at).getTime() <= this.now().getTime()) {
      return null;
    }
    this.db.run("UPDATE pairing_tokens SET used_at = ? WHERE token_hash = ?", [nowIso, tokenHash]);
    const instanceId = randomUUID();
    const credential = generateToken();
    const name = row.name ?? `instance-${instanceId.slice(0, 8)}`;
    this.db.run(
      "INSERT INTO instances (id, account_id, name, credential_hash, core_version, created_at) VALUES (?, ?, ?, ?, ?, ?)",
      [instanceId, row.account_id, name, hashToken(credential), coreVersion ?? null, nowIso],
    );
    return { instanceId, credential, accountId: row.account_id, name };
  }

  verifyCredential(instanceId: string, credential: string): InstanceRow | null {
    const row = this.db.get<{
      id: string; account_id: string; name: string; credential_hash: string;
      core_version: string | null; last_seen_at: string | null; created_at: string;
    }>("SELECT * FROM instances WHERE id = ?", [instanceId]);
    if (!row || row.credential_hash !== hashToken(credential)) return null;
    return toInstanceRow(row);
  }

  touch(instanceId: string, coreVersion?: string): void {
    if (coreVersion !== undefined) {
      this.db.run("UPDATE instances SET last_seen_at = ?, core_version = ? WHERE id = ?", [
        this.now().toISOString(), coreVersion, instanceId,
      ]);
      return;
    }
    this.db.run("UPDATE instances SET last_seen_at = ? WHERE id = ?", [this.now().toISOString(), instanceId]);
  }

  listByAccount(accountId: string): InstanceRow[] {
    return this.db
      .all<{
        id: string; account_id: string; name: string; credential_hash: string;
        core_version: string | null; last_seen_at: string | null; created_at: string;
      }>("SELECT * FROM instances WHERE account_id = ? ORDER BY created_at", [accountId])
      .map(toInstanceRow);
  }

  getOwned(instanceId: string, accountId: string): InstanceRow | null {
    const row = this.db.get<{
      id: string; account_id: string; name: string; credential_hash: string;
      core_version: string | null; last_seen_at: string | null; created_at: string;
    }>("SELECT * FROM instances WHERE id = ? AND account_id = ?", [instanceId, accountId]);
    return row ? toInstanceRow(row) : null;
  }

  remove(instanceId: string, accountId: string): boolean {
    if (!this.getOwned(instanceId, accountId)) return false;
    this.db.run("DELETE FROM instances WHERE id = ?", [instanceId]);
    return true;
  }
}

function toInstanceRow(row: {
  id: string; account_id: string; name: string;
  core_version: string | null; last_seen_at: string | null; created_at: string;
}): InstanceRow {
  return {
    id: row.id,
    accountId: row.account_id,
    name: row.name,
    coreVersion: row.core_version,
    lastSeenAt: row.last_seen_at,
    createdAt: row.created_at,
  };
}
```

- [ ] **Step 4: 跑测试确认通过**

Run: `bun test tests/unit/packages/relay/stores-instances.test.ts && bun run build:relay`
Expected: 3 PASS。

- [ ] **Step 5: Commit**

```bash
git add packages/relay/src/stores/instances.ts tests/unit/packages/relay/stores-instances.test.ts
git commit -m "feat(relay): pairing-token and instance store"
```

---

### Task 7: gateway/instance-gateway.ts — 实例 WS 网关（TDD）

**Files:**
- Create: `packages/relay/src/gateway/instance-gateway.ts`
- Test: `tests/unit/packages/relay/gateway.test.ts`

设计：网关只依赖一个最小 `GatewaySocket` 结构接口（`ws` 的 WebSocket 结构兼容），单测用真 `ws` 走环回端口（已验证 bun 下可用）。握手：未认证连接的第一个 req 必须是 `instance.register`（配对 token 换凭证）或 `instance.auth`（长期凭证），其余一律关闭。认证后：`res` 按 id 解析挂起请求；`event` 更新 last_seen 并回调 `onEvent`。

- [ ] **Step 1: 写失败测试**

```ts
import { expect, test } from "bun:test";
import { WebSocket, WebSocketServer } from "ws";

import {
  MSG,
  RELAY_PROTOCOL_VERSION,
  decodeEnvelope,
  encodeEnvelope,
  type RelayEnvelope,
} from "../../../../packages/relay-protocol/src/index";
import { createSqlDriver, initSchema } from "../../../../packages/relay/src/db";
import { AccountStore } from "../../../../packages/relay/src/stores/accounts";
import { InstanceStore } from "../../../../packages/relay/src/stores/instances";
import { InstanceGateway } from "../../../../packages/relay/src/gateway/instance-gateway";

async function makeGateway() {
  const db = await createSqlDriver(":memory:");
  initSchema(db);
  const accounts = new AccountStore(db);
  const instances = new InstanceStore(db);
  const account = accounts.createAccount("alice", "pw", "member");
  const events: unknown[] = [];
  const gateway = new InstanceGateway({
    instances,
    requestTimeoutMs: 500,
    onEvent: (instanceId, accountId, envelope) => events.push({ instanceId, accountId, type: envelope.type }),
  });
  const wss = new WebSocketServer({ port: 0 });
  await new Promise<void>((resolve) => wss.on("listening", () => resolve()));
  wss.on("connection", (socket) => gateway.handleConnection(socket));
  const port = (wss.address() as { port: number }).port;
  return { gateway, instances, account, events, wss, url: `ws://127.0.0.1:${port}` };
}

function connect(url: string): Promise<WebSocket> {
  const socket = new WebSocket(url);
  return new Promise((resolve, reject) => {
    socket.on("open", () => resolve(socket));
    socket.on("error", reject);
  });
}

function nextMessage(socket: WebSocket): Promise<RelayEnvelope> {
  return new Promise((resolve, reject) => {
    socket.once("message", (data) => {
      const decoded = decodeEnvelope(String(data));
      decoded.ok ? resolve(decoded.envelope) : reject(new Error(decoded.error));
    });
  });
}

test("register handshake redeems pairing token and marks instance online", async () => {
  const { gateway, instances, account, wss, url } = await makeGateway();
  const issued = instances.issuePairingToken(account.id, "pc", 600_000);
  const socket = await connect(url);
  socket.send(encodeEnvelope({
    protocolVersion: RELAY_PROTOCOL_VERSION, kind: "req", id: "hs-1",
    type: MSG.instanceRegister, payload: { pairingToken: issued.token, coreVersion: "0.11.0" },
  }));
  const res = await nextMessage(socket);
  expect(res.kind).toBe("res");
  expect(res.id).toBe("hs-1");
  const payload = res.payload as { instanceId: string; credential: string };
  expect(typeof payload.credential).toBe("string");
  expect(gateway.isOnline(payload.instanceId)).toBe(true);
  socket.close();
  await new Promise((resolve) => setTimeout(resolve, 50));
  expect(gateway.isOnline(payload.instanceId)).toBe(false);
  wss.close();
});

test("sendRequest round-trips through an authed instance; offline and timeout reject", async () => {
  const { gateway, instances, account, wss, url } = await makeGateway();
  const redeemed = instances.redeemPairingToken(
    instances.issuePairingToken(account.id, "pc", 600_000).token,
  )!;
  await expect(gateway.sendRequest(redeemed.instanceId, MSG.sessionsList, {})).rejects.toThrow("instance-offline");

  const socket = await connect(url);
  socket.send(encodeEnvelope({
    protocolVersion: RELAY_PROTOCOL_VERSION, kind: "req", id: "hs-1",
    type: MSG.instanceAuth, payload: { instanceId: redeemed.instanceId, credential: redeemed.credential },
  }));
  await nextMessage(socket); // auth res
  socket.on("message", (data) => {
    const decoded = decodeEnvelope(String(data));
    if (decoded.ok && decoded.envelope.kind === "req" && decoded.envelope.type === MSG.sessionsList) {
      socket.send(encodeEnvelope({
        protocolVersion: RELAY_PROTOCOL_VERSION, kind: "res", id: decoded.envelope.id,
        type: decoded.envelope.type, payload: { sessions: [] },
      }));
    }
    // requests of other types are ignored -> sendRequest times out
  });
  const result = await gateway.sendRequest(redeemed.instanceId, MSG.sessionsList, {});
  expect(result).toEqual({ sessions: [] });
  await expect(gateway.sendRequest(redeemed.instanceId, MSG.prompt, {})).rejects.toThrow("timeout");
  socket.close();
  wss.close();
});

test("unauthenticated non-handshake message closes the socket; bad pairing token gets error res", async () => {
  const { instances, account, wss, url, events, gateway } = await makeGateway();
  const bad = await connect(url);
  const closed = new Promise<void>((resolve) => bad.on("close", () => resolve()));
  bad.send(encodeEnvelope({ protocolVersion: RELAY_PROTOCOL_VERSION, kind: "event", type: MSG.instanceEvent, payload: {} }));
  await closed;

  const socket = await connect(url);
  socket.send(encodeEnvelope({
    protocolVersion: RELAY_PROTOCOL_VERSION, kind: "req", id: "hs-1",
    type: MSG.instanceRegister, payload: { pairingToken: "expired-or-bogus" },
  }));
  const res = await nextMessage(socket);
  expect((res.payload as { error: { code: string } }).error.code).toBe("pairing-failed");

  // authed instance events reach onEvent
  const redeemed = instances.redeemPairingToken(instances.issuePairingToken(account.id, "pc", 600_000).token)!;
  const authed = await connect(url);
  authed.send(encodeEnvelope({
    protocolVersion: RELAY_PROTOCOL_VERSION, kind: "req", id: "hs-1",
    type: MSG.instanceAuth, payload: { instanceId: redeemed.instanceId, credential: redeemed.credential },
  }));
  await nextMessage(authed);
  authed.send(encodeEnvelope({
    protocolVersion: RELAY_PROTOCOL_VERSION, kind: "event",
    type: MSG.instanceEvent, payload: { event: { type: "sessions-changed" } },
  }));
  await new Promise((resolve) => setTimeout(resolve, 50));
  expect(events).toContainEqual({ instanceId: redeemed.instanceId, accountId: redeemed.accountId, type: MSG.instanceEvent });
  expect(gateway.isOnline(redeemed.instanceId)).toBe(true);
  socket.close();
  authed.close();
  wss.close();
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `bun test tests/unit/packages/relay/gateway.test.ts`
Expected: FAIL（模块不存在）。

- [ ] **Step 3: 实现 instance-gateway.ts**

```ts
import {
  MSG,
  RELAY_PROTOCOL_VERSION,
  decodeEnvelope,
  encodeEnvelope,
  errorPayload,
  type InstanceAuthPayload,
  type InstanceRegisterPayload,
  type RelayEnvelope,
} from "@ganglion/xacpx-relay-protocol";

import type { InstanceStore } from "../stores/instances.js";

export interface GatewaySocket {
  send(data: string): void;
  close(code?: number, reason?: string): void;
  on(event: "message", listener: (data: unknown) => void): unknown;
  on(event: "close", listener: () => void): unknown;
}

export interface InstanceGatewayDeps {
  instances: Pick<InstanceStore, "redeemPairingToken" | "verifyCredential" | "touch">;
  requestTimeoutMs?: number;
  onEvent?: (instanceId: string, accountId: string, envelope: RelayEnvelope) => void;
}

interface PendingRequest {
  resolve: (payload: unknown) => void;
  reject: (error: Error) => void;
  timer: ReturnType<typeof setTimeout>;
}

export class InstanceGateway {
  private readonly connections = new Map<string, { socket: GatewaySocket; accountId: string }>();
  private readonly pending = new Map<string, PendingRequest>();
  private seq = 0;

  constructor(private readonly deps: InstanceGatewayDeps) {}

  isOnline(instanceId: string): boolean {
    return this.connections.has(instanceId);
  }

  handleConnection(socket: GatewaySocket): void {
    let authed: { instanceId: string; accountId: string } | null = null;

    socket.on("message", (data) => {
      const decoded = decodeEnvelope(String(data));
      if (!decoded.ok) {
        socket.send(encodeEnvelope({
          protocolVersion: RELAY_PROTOCOL_VERSION, kind: "event", type: "relay.protocol-error",
          payload: errorPayload(decoded.error, decoded.detail ?? "invalid envelope"),
        }));
        if (!authed) socket.close(4400, decoded.error);
        return;
      }
      const envelope = decoded.envelope;

      if (!authed) {
        authed = this.handleHandshake(socket, envelope);
        if (authed) {
          this.connections.set(authed.instanceId, { socket, accountId: authed.accountId });
        }
        return;
      }

      if (envelope.kind === "res" && envelope.id) {
        const waiting = this.pending.get(envelope.id);
        if (waiting) {
          clearTimeout(waiting.timer);
          this.pending.delete(envelope.id);
          waiting.resolve(envelope.payload);
        }
        return;
      }
      if (envelope.kind === "event") {
        this.deps.instances.touch(authed.instanceId);
        this.deps.onEvent?.(authed.instanceId, authed.accountId, envelope);
      }
    });

    socket.on("close", () => {
      if (authed) this.connections.delete(authed.instanceId);
    });
  }

  /** Returns the authed identity, or null (after replying/closing) when the handshake fails. */
  private handleHandshake(
    socket: GatewaySocket,
    envelope: RelayEnvelope,
  ): { instanceId: string; accountId: string } | null {
    const respond = (payload: unknown) => {
      socket.send(encodeEnvelope({
        protocolVersion: RELAY_PROTOCOL_VERSION, kind: "res",
        id: envelope.id ?? "handshake", type: envelope.type, payload,
      }));
    };
    if (envelope.kind !== "req") {
      socket.close(4401, "unauthenticated");
      return null;
    }
    if (envelope.type === MSG.instanceRegister) {
      const payload = envelope.payload as InstanceRegisterPayload;
      const redeemed = this.deps.instances.redeemPairingToken(payload?.pairingToken ?? "", payload?.coreVersion);
      if (!redeemed) {
        respond(errorPayload("pairing-failed", "pairing token is invalid, expired, or already used"));
        return null;
      }
      respond({ instanceId: redeemed.instanceId, credential: redeemed.credential });
      this.deps.instances.touch(redeemed.instanceId);
      return { instanceId: redeemed.instanceId, accountId: redeemed.accountId };
    }
    if (envelope.type === MSG.instanceAuth) {
      const payload = envelope.payload as InstanceAuthPayload;
      const instance = this.deps.instances.verifyCredential(payload?.instanceId ?? "", payload?.credential ?? "");
      if (!instance) {
        respond(errorPayload("auth-failed", "unknown instance or bad credential"));
        socket.close(4403, "auth-failed");
        return null;
      }
      respond({ ok: true });
      this.deps.instances.touch(instance.id, payload?.coreVersion);
      return { instanceId: instance.id, accountId: instance.accountId };
    }
    socket.close(4401, "unauthenticated");
    return null;
  }

  async sendRequest(instanceId: string, type: string, payload: unknown): Promise<unknown> {
    const connection = this.connections.get(instanceId);
    if (!connection) {
      throw new Error("instance-offline");
    }
    const id = `relay-${++this.seq}`;
    const timeoutMs = this.deps.requestTimeoutMs ?? 15_000;
    return await new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error("timeout"));
      }, timeoutMs);
      this.pending.set(id, { resolve, reject, timer });
      connection.socket.send(encodeEnvelope({
        protocolVersion: RELAY_PROTOCOL_VERSION, kind: "req", id, type, payload,
      }));
    });
  }
}
```

- [ ] **Step 4: 跑测试确认通过**

Run: `bun test tests/unit/packages/relay/gateway.test.ts && bun run build:relay`
Expected: 3 PASS。

- [ ] **Step 5: Commit**

```bash
git add packages/relay/src/gateway tests/unit/packages/relay/gateway.test.ts
git commit -m "feat(relay): instance gateway with register/auth handshake and request correlation"
```

---

### Task 8: http/app.ts — Hono API（TDD，app.request 免端口）

**Files:**
- Create: `packages/relay/src/http/app.ts`
- Test: `tests/unit/packages/relay/http-app.test.ts`

安全要点：登录限流（内存固定窗口，按 username）；cookie `xrelay_session` HttpOnly+SameSite=Lax；RPC 代理只放行 `control.*` 且**服务端覆写** chat 域 payload 的 `chatKey`/`senderId`/`isOwner`（`chatKey = relay:<accountId>`），前端不可伪造。

- [ ] **Step 1: 写失败测试**

```ts
import { expect, test } from "bun:test";

import { MSG } from "../../../../packages/relay-protocol/src/index";
import { createSqlDriver, initSchema } from "../../../../packages/relay/src/db";
import { AccountStore } from "../../../../packages/relay/src/stores/accounts";
import { InstanceStore } from "../../../../packages/relay/src/stores/instances";
import { createApp } from "../../../../packages/relay/src/http/app";

async function makeApp() {
  const db = await createSqlDriver(":memory:");
  initSchema(db);
  const accounts = new AccountStore(db);
  const instances = new InstanceStore(db);
  const admin = accounts.createAccount("admin", "admin-pw", "admin");
  const rpcCalls: Array<{ instanceId: string; type: string; payload: unknown }> = [];
  const gateway = {
    isOnline: (id: string) => id !== "offline-id",
    sendRequest: async (instanceId: string, type: string, payload: unknown) => {
      rpcCalls.push({ instanceId, type, payload });
      return { sessions: [] };
    },
  };
  const app = createApp({ accounts, instances, gateway });
  const login = async (username: string, password: string) => {
    const res = await app.request("/api/login", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ username, password }),
    });
    return { res, cookie: res.headers.get("set-cookie")?.split(";")[0] ?? "" };
  };
  return { app, accounts, instances, admin, gateway, rpcCalls, login };
}

test("login sets HttpOnly cookie; bad password 401; rate limit kicks in", async () => {
  const { app, login } = await makeApp();
  const { res, cookie } = await login("admin", "admin-pw");
  expect(res.status).toBe(200);
  expect(res.headers.get("set-cookie")).toContain("HttpOnly");
  const me = await app.request("/api/me", { headers: { cookie } });
  expect(((await me.json()) as { username: string }).username).toBe("admin");
  expect((await app.request("/api/me")).status).toBe(401);
  expect((await login("admin", "nope")).res.status).toBe(401);
  for (let i = 0; i < 12; i++) await login("admin", "nope");
  expect((await login("admin", "nope")).res.status).toBe(429);
});

test("invite -> register -> member login; invites are admin-only", async () => {
  const { app, login } = await makeApp();
  const { cookie } = await login("admin", "admin-pw");
  const inviteRes = await app.request("/api/invites", { method: "POST", headers: { cookie } });
  expect(inviteRes.status).toBe(200);
  const { invite } = (await inviteRes.json()) as { invite: string };
  const registerRes = await app.request("/api/register", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ invite, username: "alice", password: "alice-pw" }),
  });
  expect(registerRes.status).toBe(200);
  const { cookie: aliceCookie } = await login("alice", "alice-pw");
  expect((await app.request("/api/invites", { method: "POST", headers: { cookie: aliceCookie } })).status).toBe(403);
  // reused invite rejected
  const reuse = await app.request("/api/register", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ invite, username: "bob", password: "pw" }),
  });
  expect(reuse.status).toBe(403);
});

test("instances: pairing token, list with online flag, account isolation, rpc stamping", async () => {
  const { app, instances, login, rpcCalls } = await makeApp();
  const { cookie } = await login("admin", "admin-pw");
  const tokenRes = await app.request("/api/instances/pairing-token", {
    method: "POST", headers: { cookie, "content-type": "application/json" }, body: JSON.stringify({ name: "pc" }),
  });
  expect(tokenRes.status).toBe(200);
  const { token } = (await tokenRes.json()) as { token: string };
  const redeemed = instances.redeemPairingToken(token)!;

  const listRes = await app.request("/api/instances", { headers: { cookie } });
  const { instances: listed } = (await listRes.json()) as { instances: Array<{ id: string; online: boolean }> };
  expect(listed[0]?.id).toBe(redeemed.instanceId);
  expect(listed[0]?.online).toBe(true);

  // rpc: stamps chatKey/senderId/isOwner server-side, ignoring client-supplied values
  const rpcRes = await app.request(`/api/instances/${redeemed.instanceId}/rpc`, {
    method: "POST", headers: { cookie, "content-type": "application/json" },
    body: JSON.stringify({ type: MSG.prompt, payload: { chatKey: "forged", senderId: "forged", sessionAlias: "s", text: "hi" } }),
  });
  expect(rpcRes.status).toBe(200);
  const stamped = rpcCalls[0]?.payload as { chatKey: string; senderId: string; isOwner: boolean };
  expect(stamped.chatKey).toBe(`relay:${redeemed.accountId}`);
  expect(stamped.senderId).toBe(redeemed.accountId);
  expect(stamped.isOwner).toBe(true);

  // non-control types rejected; foreign instance 404
  expect((await app.request(`/api/instances/${redeemed.instanceId}/rpc`, {
    method: "POST", headers: { cookie, "content-type": "application/json" },
    body: JSON.stringify({ type: "instance.register", payload: {} }),
  })).status).toBe(400);
  expect((await app.request(`/api/instances/not-mine/rpc`, {
    method: "POST", headers: { cookie, "content-type": "application/json" },
    body: JSON.stringify({ type: MSG.sessionsList, payload: {} }),
  })).status).toBe(404);
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `bun test tests/unit/packages/relay/http-app.test.ts`
Expected: FAIL。

- [ ] **Step 3: 实现 http/app.ts**

```ts
import { Hono } from "hono";
import { deleteCookie, getCookie, setCookie } from "hono/cookie";

import { MSG } from "@ganglion/xacpx-relay-protocol";

import type { AccountRow, AccountStore } from "../stores/accounts.js";
import type { InstanceStore } from "../stores/instances.js";

export interface GatewayForApp {
  isOnline(instanceId: string): boolean;
  sendRequest(instanceId: string, type: string, payload: unknown): Promise<unknown>;
}

export interface AppDeps {
  accounts: AccountStore;
  instances: InstanceStore;
  gateway: GatewayForApp;
  sessionTtlMs?: number;
  inviteTtlMs?: number;
  pairingTtlMs?: number;
  now?: () => Date;
}

const SESSION_COOKIE = "xrelay_session";
const LOGIN_WINDOW_MS = 10 * 60 * 1000;
const LOGIN_MAX_FAILURES = 10;

/** Chat-scoped control RPCs get chatKey/senderId/isOwner stamped server-side. */
const CHAT_SCOPED_TYPES = new Set<string>([
  MSG.prompt, MSG.promptCancel, MSG.commandExecute,
  MSG.scheduledList, MSG.scheduledCreate, MSG.scheduledCancel,
]);

type Vars = { Variables: { account: AccountRow } };

export function createApp(deps: AppDeps): Hono<Vars> {
  const sessionTtlMs = deps.sessionTtlMs ?? 7 * 24 * 60 * 60 * 1000;
  const inviteTtlMs = deps.inviteTtlMs ?? 24 * 60 * 60 * 1000;
  const pairingTtlMs = deps.pairingTtlMs ?? 10 * 60 * 1000;
  const now = deps.now ?? (() => new Date());
  const loginFailures = new Map<string, { count: number; windowStart: number }>();

  const app = new Hono<Vars>();

  app.post("/api/login", async (c) => {
    const body = (await c.req.json().catch(() => ({}))) as { username?: string; password?: string };
    const username = body.username ?? "";
    const failures = loginFailures.get(username);
    const nowMs = now().getTime();
    if (failures && nowMs - failures.windowStart < LOGIN_WINDOW_MS && failures.count >= LOGIN_MAX_FAILURES) {
      return c.json({ error: "too-many-attempts" }, 429);
    }
    const account = deps.accounts.verifyLogin(username, body.password ?? "");
    if (!account) {
      const entry = failures && nowMs - failures.windowStart < LOGIN_WINDOW_MS
        ? { count: failures.count + 1, windowStart: failures.windowStart }
        : { count: 1, windowStart: nowMs };
      loginFailures.set(username, entry);
      return c.json({ error: "invalid-credentials" }, 401);
    }
    loginFailures.delete(username);
    const token = deps.accounts.createWebSession(account.id, sessionTtlMs);
    setCookie(c, SESSION_COOKIE, token, {
      httpOnly: true, sameSite: "Lax", path: "/", maxAge: Math.floor(sessionTtlMs / 1000),
    });
    return c.json({ username: account.username, role: account.role });
  });

  app.post("/api/register", async (c) => {
    const body = (await c.req.json().catch(() => ({}))) as { invite?: string; username?: string; password?: string };
    if (!body.invite || !body.username || !body.password) return c.json({ error: "missing-fields" }, 400);
    if (!deps.accounts.validateInvite(body.invite)) return c.json({ error: "invalid-invite" }, 403);
    if (deps.accounts.findByUsername(body.username)) return c.json({ error: "username-taken" }, 409);
    const account = deps.accounts.createAccount(body.username, body.password, "member");
    deps.accounts.markInviteUsed(body.invite, account.id);
    return c.json({ username: account.username, role: account.role });
  });

  app.use("/api/*", async (c, next) => {
    if (c.req.path === "/api/login" || c.req.path === "/api/register") return next();
    const token = getCookie(c, SESSION_COOKIE);
    const account = token ? deps.accounts.getSessionAccount(token) : null;
    if (!account) return c.json({ error: "unauthorized" }, 401);
    c.set("account", account);
    return next();
  });

  app.post("/api/logout", (c) => {
    const token = getCookie(c, SESSION_COOKIE);
    if (token) deps.accounts.deleteWebSession(token);
    deleteCookie(c, SESSION_COOKIE, { path: "/" });
    return c.json({ ok: true });
  });

  app.get("/api/me", (c) => {
    const account = c.get("account");
    return c.json({ username: account.username, role: account.role });
  });

  app.post("/api/invites", (c) => {
    const account = c.get("account");
    if (account.role !== "admin") return c.json({ error: "admin-only" }, 403);
    const invite = deps.accounts.createInvite(account.id, inviteTtlMs);
    return c.json({ invite: invite.token, expiresAt: invite.expiresAt });
  });

  app.get("/api/instances", (c) => {
    const account = c.get("account");
    const rows = deps.instances.listByAccount(account.id).map((row) => ({
      ...row,
      online: deps.gateway.isOnline(row.id),
    }));
    return c.json({ instances: rows });
  });

  app.post("/api/instances/pairing-token", async (c) => {
    const account = c.get("account");
    const body = (await c.req.json().catch(() => ({}))) as { name?: string };
    const issued = deps.instances.issuePairingToken(account.id, body.name, pairingTtlMs);
    return c.json({ token: issued.token, expiresAt: issued.expiresAt });
  });

  app.delete("/api/instances/:id", (c) => {
    const account = c.get("account");
    const removed = deps.instances.remove(c.req.param("id"), account.id);
    return removed ? c.json({ ok: true }) : c.json({ error: "not-found" }, 404);
  });

  app.post("/api/instances/:id/rpc", async (c) => {
    const account = c.get("account");
    const instance = deps.instances.getOwned(c.req.param("id"), account.id);
    if (!instance) return c.json({ error: "not-found" }, 404);
    const body = (await c.req.json().catch(() => ({}))) as { type?: string; payload?: unknown };
    if (!body.type || !body.type.startsWith("control.")) return c.json({ error: "invalid-rpc-type" }, 400);
    let payload = body.payload ?? {};
    if (CHAT_SCOPED_TYPES.has(body.type)) {
      payload = {
        ...(payload as Record<string, unknown>),
        chatKey: `relay:${account.id}`,
        senderId: account.id,
        isOwner: true,
      };
    }
    try {
      const result = await deps.gateway.sendRequest(instance.id, body.type, payload);
      return c.json({ result });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (message === "instance-offline") return c.json({ error: message }, 503);
      if (message === "timeout") return c.json({ error: message }, 504);
      return c.json({ error: message }, 500);
    }
  });

  return app;
}
```

- [ ] **Step 4: 跑测试确认通过**

Run: `bun test tests/unit/packages/relay/http-app.test.ts && bun run build:relay`
Expected: 3 PASS。

- [ ] **Step 5: Commit**

```bash
git add packages/relay/src/http tests/unit/packages/relay/http-app.test.ts
git commit -m "feat(relay): HTTP API with auth, invites, instances, and stamped rpc proxy"
```

---

### Task 9: server.ts 组装 + cli.ts（TDD）

**Files:**
- Create: `packages/relay/src/server.ts`
- Modify: `packages/relay/src/cli.ts`（替换占位）
- Test: `tests/unit/packages/relay/cli.test.ts`

- [ ] **Step 1: 实现 server.ts**（先实现——本任务的 TDD 重心在 CLI 解析；server 的运行时验证由 Task 14 集成测试与手工 runbook 覆盖）

```ts
import { serve, type ServerType } from "@hono/node-server";
import { WebSocketServer } from "ws";

import { createSqlDriver, initSchema, type SqlDriver } from "./db.js";
import { AccountStore } from "./stores/accounts.js";
import { InstanceStore } from "./stores/instances.js";
import { InstanceGateway } from "./gateway/instance-gateway.js";
import { createApp } from "./http/app.js";

export interface RelayRuntime {
  db: SqlDriver;
  accounts: AccountStore;
  instances: InstanceStore;
  gateway: InstanceGateway;
  app: ReturnType<typeof createApp>;
  close(): void;
}

/** Testable assembly without any network listener. */
export async function createRelayRuntime(dbPath: string): Promise<RelayRuntime> {
  const db = await createSqlDriver(dbPath);
  initSchema(db);
  const accounts = new AccountStore(db);
  const instances = new InstanceStore(db);
  const gateway = new InstanceGateway({ instances });
  const app = createApp({ accounts, instances, gateway });
  return { db, accounts, instances, gateway, app, close: () => db.close() };
}

export interface StartRelayOptions {
  dbPath: string;
  httpPort: number;
  wsPort: number;
  host?: string;
}

export interface RunningRelay {
  runtime: RelayRuntime;
  httpPort: number;
  wsPort: number;
  close(): Promise<void>;
}

export async function startRelayServer(options: StartRelayOptions): Promise<RunningRelay> {
  const runtime = await createRelayRuntime(options.dbPath);
  const host = options.host ?? "0.0.0.0";

  const httpServer: ServerType = await new Promise((resolve) => {
    const server = serve(
      { fetch: runtime.app.fetch, port: options.httpPort, hostname: host },
      () => resolve(server),
    );
  });

  const wss = new WebSocketServer({ port: options.wsPort, host });
  await new Promise<void>((resolve) => wss.on("listening", () => resolve()));
  wss.on("connection", (socket) => runtime.gateway.handleConnection(socket));

  const httpPort = (httpServer.address() as { port: number }).port;
  const wsPort = (wss.address() as { port: number }).port;
  return {
    runtime,
    httpPort,
    wsPort,
    close: async () => {
      await new Promise<void>((resolve) => wss.close(() => resolve()));
      await new Promise<void>((resolve) => httpServer.close(() => resolve()));
      runtime.close();
    },
  };
}
```

- [ ] **Step 2: 写 CLI 失败测试**

```ts
import { expect, test } from "bun:test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { runRelayCli } from "../../../../packages/relay/src/cli";

function makeIo() {
  const lines: string[] = [];
  return { lines, print: (line: string) => lines.push(line) };
}

test("init-admin creates the admin and prints generated password once", async () => {
  const dbPath = join(mkdtempSync(join(tmpdir(), "relay-cli-")), "relay.db");
  const io = makeIo();
  const code = await runRelayCli(["init-admin", "--username", "admin", "--db", dbPath], io);
  expect(code).toBe(0);
  expect(io.lines.join("\n")).toContain("admin");
  expect(io.lines.join("\n")).toMatch(/password: \S+/);
  // second run refuses (admin exists)
  const again = await runRelayCli(["init-admin", "--username", "admin", "--db", dbPath], makeIo());
  expect(again).toBe(1);
});

test("token new issues a pairing token for an existing account", async () => {
  const dbPath = join(mkdtempSync(join(tmpdir(), "relay-cli-")), "relay.db");
  await runRelayCli(["init-admin", "--username", "admin", "--db", dbPath], makeIo());
  const io = makeIo();
  const code = await runRelayCli(["token", "new", "--account", "admin", "--name", "pc", "--db", dbPath], io);
  expect(code).toBe(0);
  expect(io.lines.join("\n")).toMatch(/pairing token: \S{40,}/);
  expect(await runRelayCli(["token", "new", "--account", "ghost", "--db", dbPath], makeIo())).toBe(1);
});

test("unknown command prints usage and exits 1", async () => {
  const io = makeIo();
  expect(await runRelayCli(["bogus"], io)).toBe(1);
  expect(io.lines.join("\n")).toContain("Usage");
});
```

- [ ] **Step 3: 跑测试确认失败**

Run: `bun test tests/unit/packages/relay/cli.test.ts`
Expected: FAIL（runRelayCli 不存在）。

- [ ] **Step 4: 实现 cli.ts**

```ts
import { generateToken } from "./auth.js";
import { createRelayRuntime, startRelayServer } from "./server.js";

export interface RelayCliIo {
  print(line: string): void;
}

const USAGE = [
  "Usage: xacpx-relay <command>",
  "  start       --db <path> [--http-port 8787] [--ws-port 8788] [--host 0.0.0.0]",
  "  init-admin  --username <name> [--password <pw>] --db <path>",
  "  token new   --account <username> [--name <label>] [--ttl-minutes 10] --db <path>",
].join("\n");

function flag(args: string[], name: string): string | undefined {
  const index = args.indexOf(name);
  const value = index >= 0 ? args[index + 1] : undefined;
  return value && !value.startsWith("--") ? value : undefined;
}

export async function runRelayCli(args: string[], io: RelayCliIo): Promise<number> {
  const dbPath = flag(args, "--db") ?? "./relay.db";

  if (args[0] === "init-admin") {
    const username = flag(args, "--username");
    if (!username) {
      io.print(USAGE);
      return 1;
    }
    const runtime = await createRelayRuntime(dbPath);
    try {
      if (runtime.accounts.findByUsername(username)) {
        io.print(`account already exists: ${username}`);
        return 1;
      }
      const password = flag(args, "--password") ?? generateToken().slice(0, 16);
      runtime.accounts.createAccount(username, password, "admin");
      io.print(`admin account created: ${username}`);
      io.print(`password: ${password}`);
      io.print("(store it now — it is not shown again)");
      return 0;
    } finally {
      runtime.close();
    }
  }

  if (args[0] === "token" && args[1] === "new") {
    const username = flag(args, "--account");
    if (!username) {
      io.print(USAGE);
      return 1;
    }
    const runtime = await createRelayRuntime(dbPath);
    try {
      const account = runtime.accounts.findByUsername(username);
      if (!account) {
        io.print(`no such account: ${username}`);
        return 1;
      }
      const ttlMinutes = Number(flag(args, "--ttl-minutes") ?? "10");
      const issued = runtime.instances.issuePairingToken(account.id, flag(args, "--name"), ttlMinutes * 60_000);
      io.print(`pairing token: ${issued.token}`);
      io.print(`expires at: ${issued.expiresAt}`);
      io.print(`pair with: xacpx channel add relay --url ws://<relay-host>:<ws-port> --token <the-token>`);
      return 0;
    } finally {
      runtime.close();
    }
  }

  if (args[0] === "start") {
    const running = await startRelayServer({
      dbPath,
      httpPort: Number(flag(args, "--http-port") ?? "8787"),
      wsPort: Number(flag(args, "--ws-port") ?? "8788"),
      host: flag(args, "--host"),
    });
    io.print(`xacpx-relay listening: http :${running.httpPort}, instance ws :${running.wsPort}, db ${dbPath}`);
    return await new Promise<number>((resolve) => {
      const shutdown = () => {
        void running.close().then(() => resolve(0));
      };
      process.once("SIGINT", shutdown);
      process.once("SIGTERM", shutdown);
    });
  }

  io.print(USAGE);
  return 1;
}

// bin entry: run only when executed directly, not when imported by tests.
const isMain = typeof process !== "undefined" && process.argv[1]?.endsWith("cli.js");
if (isMain) {
  runRelayCli(process.argv.slice(2), { print: (line) => console.log(line) }).then(
    (code) => process.exit(code),
    (error) => {
      console.error(error instanceof Error ? error.message : String(error));
      process.exit(1);
    },
  );
}
```

- [ ] **Step 5: 跑测试确认通过**

Run: `bun test tests/unit/packages/relay/cli.test.ts && bun run build:relay`
Expected: 3 PASS。

- [ ] **Step 6: Commit**

```bash
git add packages/relay/src/server.ts packages/relay/src/cli.ts tests/unit/packages/relay/cli.test.ts
git commit -m "feat(relay): server assembly and xacpx-relay CLI (start/init-admin/token)"
```

---

### Task 10: channel-relay 脚手架 + plugin-api coreHomeDir seam + config/credential-store（TDD）

**Files:**
- Create: `packages/channel-relay/package.json`、`tsconfig.json`、`README.md`、`src/config.ts`、`src/credential-store.ts`
- Modify: `src/plugin-api.ts`（核心，导出 coreHomeDir）、`package.json`（根，build 脚本）
- Test: `tests/unit/packages/channel-relay/config.test.ts`、`tests/unit/packages/channel-relay/credential-store.test.ts`

- [ ] **Step 1: 核心 seam——plugin-api 导出 coreHomeDir**

先 Read `src/runtime/core-home.ts` 确认 `coreHomeDir` 的导出形式与签名（main.ts:6 以 `import { coreHomeDir } from "./runtime/core-home"` 使用；预期 `(): string` 返回 `~/.xacpx` 或 env 覆盖）。然后在 `src/plugin-api.ts` 追加（带注释，仿现有 runtime helpers 段落风格）：

```ts
// Core home directory (~/.xacpx or env override). Channel plugins that persist
// their own runtime credentials (weixin precedent) anchor their state files here.
export { coreHomeDir } from "./runtime/core-home.js";
```

若实际签名不同（如带参数或异步），按实际调整本任务后续 `defaultCredentialPath` 的用法并在报告说明。

- [ ] **Step 2: channel-relay package.json**（feishu 模式 + ws + relay-protocol）

```json
{
  "name": "@ganglion/xacpx-channel-relay",
  "version": "0.1.0",
  "description": "Relay hub connector channel plugin for xacpx.",
  "license": "MIT",
  "keywords": ["xacpx", "relay", "channel", "plugin"],
  "repository": {
    "type": "git",
    "url": "git+https://github.com/gadzan/xacpx.git",
    "directory": "packages/channel-relay"
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
  "peerDependencies": {
    "xacpx": ">=0.11.0-0"
  },
  "peerDependenciesMeta": {
    "xacpx": { "optional": true }
  },
  "publishConfig": { "access": "public" },
  "dependencies": {
    "@ganglion/xacpx-relay-protocol": "^0.1.0",
    "ws": "^8.20.0"
  }
}
```

（peerDep 下限 0.11.0-0：`ChannelStartInput.control` 与 `coreHomeDir` 都是 0.11 才有的 plugin-api 面。）

- [ ] **Step 3: tsconfig.json**（feishu 同款 paths）

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
    "baseUrl": "../..",
    "paths": {
      "xacpx/plugin-api": ["dist/plugin-api"]
    },
    "ignoreDeprecations": "6.0"
  },
  "include": ["src/**/*.ts"]
}
```

README.md：

```markdown
# @ganglion/xacpx-channel-relay

Connector channel plugin: dials out from a local xacpx instance to a
self-hosted @ganglion/xacpx-relay hub over WebSocket.

Pairing: `xacpx channel add relay --url ws://<relay-host>:8788 --token <pairing-token>`.
On first connect the pairing token is exchanged for a long-lived instance
credential stored at `<xacpx-home>/relay/credential.json` (never in config.json).
```

- [ ] **Step 4: 根 package.json 构建脚本**

仿 `build:channel-feishu` 新增（注意 external 三个运行时依赖）：

```json
"clean:channel-relay": "node -e \"require('node:fs').rmSync('packages/channel-relay/dist', { recursive: true, force: true })\"",
"build:channel-relay": "bun run build:plugin-api && bun run build:relay-protocol && bun run clean:channel-relay && bun build ./packages/channel-relay/src/index.ts --outdir ./packages/channel-relay/dist --target node --external xacpx --external ws --external @ganglion/xacpx-relay-protocol && tsc -p packages/channel-relay/tsconfig.json",
```

`build:packages` 末尾追加 ` && bun run build:channel-relay`。然后 `bun install`（workspace 链接新包；**若 bun.lock 变更，这是 Task 10 唯一合法的一次**，与脚手架一起提交）。

- [ ] **Step 5: 写 config/credential-store 失败测试**

`tests/unit/packages/channel-relay/config.test.ts`：

```ts
import { expect, test } from "bun:test";

import { parseRelayChannelConfig } from "../../../../packages/channel-relay/src/config";

test("parses url, pairingToken, and name", () => {
  expect(parseRelayChannelConfig({ url: "wss://hub.example.com:8788", pairingToken: "tok", name: "pc" })).toEqual({
    url: "wss://hub.example.com:8788",
    pairingToken: "tok",
    name: "pc",
  });
});

test("pairingToken and name are optional; url is required and must be ws(s)://", () => {
  expect(parseRelayChannelConfig({ url: "ws://127.0.0.1:8788" })).toEqual({ url: "ws://127.0.0.1:8788" });
  expect(() => parseRelayChannelConfig({})).toThrow(/url/);
  expect(() => parseRelayChannelConfig({ url: "https://nope" })).toThrow(/ws/);
  expect(() => parseRelayChannelConfig(undefined)).toThrow(/url/);
});
```

`tests/unit/packages/channel-relay/credential-store.test.ts`：

```ts
import { expect, test } from "bun:test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { CredentialStore } from "../../../../packages/channel-relay/src/credential-store";

test("load returns null before save; save/load/clear roundtrip with 0600 file", () => {
  const filePath = join(mkdtempSync(join(tmpdir(), "relay-cred-")), "nested", "credential.json");
  const store = new CredentialStore(filePath);
  expect(store.load()).toBeNull();
  const credential = { instanceId: "i-1", credential: "secret", relayUrl: "ws://h:8788" };
  store.save(credential);
  expect(store.load()).toEqual(credential);
  store.clear();
  expect(store.load()).toBeNull();
  store.clear(); // idempotent
});

test("load tolerates corrupt file content", () => {
  const filePath = join(mkdtempSync(join(tmpdir(), "relay-cred-")), "credential.json");
  require("node:fs").writeFileSync(filePath, "{corrupt", "utf8");
  expect(new CredentialStore(filePath).load()).toBeNull();
});
```

- [ ] **Step 6: 跑测试确认失败**

Run: `bun test tests/unit/packages/channel-relay/config.test.ts tests/unit/packages/channel-relay/credential-store.test.ts`
Expected: FAIL（模块不存在）。

- [ ] **Step 7: 实现 src/config.ts 与 src/credential-store.ts**

`src/config.ts`：

```ts
export interface RelayChannelConfig {
  url: string;
  pairingToken?: string;
  name?: string;
}

export function parseRelayChannelConfig(options: Record<string, unknown> | undefined): RelayChannelConfig {
  const url = typeof options?.url === "string" ? options.url.trim() : "";
  if (!url) {
    throw new Error("relay channel requires options.url (the relay instance-gateway ws(s):// address)");
  }
  if (!url.startsWith("ws://") && !url.startsWith("wss://")) {
    throw new Error(`relay channel options.url must start with ws:// or wss://, got: ${url}`);
  }
  const config: RelayChannelConfig = { url };
  if (typeof options?.pairingToken === "string" && options.pairingToken.trim()) {
    config.pairingToken = options.pairingToken.trim();
  }
  if (typeof options?.name === "string" && options.name.trim()) {
    config.name = options.name.trim();
  }
  return config;
}
```

`src/credential-store.ts`：

```ts
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

import { coreHomeDir } from "xacpx/plugin-api";

export interface RelayCredential {
  instanceId: string;
  credential: string;
  relayUrl: string;
}

export function defaultCredentialPath(): string {
  return join(coreHomeDir(), "relay", "credential.json");
}

// Long-lived instance credential, exchanged from the one-shot pairing token on
// first connect. Lives in the xacpx state dir (weixin precedent) — NOT config.json.
export class CredentialStore {
  constructor(private readonly filePath: string) {}

  load(): RelayCredential | null {
    try {
      const parsed = JSON.parse(readFileSync(this.filePath, "utf8")) as Partial<RelayCredential>;
      if (
        typeof parsed.instanceId === "string" &&
        typeof parsed.credential === "string" &&
        typeof parsed.relayUrl === "string"
      ) {
        return { instanceId: parsed.instanceId, credential: parsed.credential, relayUrl: parsed.relayUrl };
      }
      return null;
    } catch {
      return null;
    }
  }

  save(credential: RelayCredential): void {
    mkdirSync(dirname(this.filePath), { recursive: true });
    writeFileSync(this.filePath, JSON.stringify(credential, null, 2), { encoding: "utf8", mode: 0o600 });
  }

  clear(): void {
    rmSync(this.filePath, { force: true });
  }
}
```

- [ ] **Step 8: 验证**

Run: `bun test tests/unit/packages/channel-relay/config.test.ts tests/unit/packages/channel-relay/credential-store.test.ts && bun run build:channel-relay && npx tsc --noEmit`
Expected: 全 PASS；channel-relay 构建（含 tsc -p）无错；根 tsc 无错（plugin-api 新导出）。

- [ ] **Step 9: Commit**

```bash
git add packages/channel-relay src/plugin-api.ts package.json tests/unit/packages/channel-relay
git status --short   # 若 bun.lock 有变更则一并 add
git commit -m "feat(channel-relay): scaffold connector package, config, credential store, coreHomeDir seam"
```

---

### Task 11: relay-client.ts — WS 客户端（握手/重连/req 分发）（TDD）

**Files:**
- Create: `packages/channel-relay/src/relay-client.ts`
- Test: `tests/unit/packages/channel-relay/relay-client.test.ts`

语义：
- `start(abortSignal)` 启动连接循环；`stop()`/abort 后不再重连并关闭当前连接。
- 握手：有凭证 → `instance.auth`；无凭证但有 pairingToken → `instance.register`，成功后 `credentialStore.save`。握手成功回调 `onReady`，并把重连退避归零。
- 握手被拒（错误 res）视为致命：记日志、不重连（pairing token 失效需要人工换新）。
- 连接断开（非致命、未 abort）按 `reconnectDelaysMs` 退避重连（超出数组用最后一档）。
- 认证后收到 `req` → `onRequest(envelope, respond)`，respond 用同 id 回 `res`。
- `sendEvent(type, payload)`：连接就绪时发 event 信封，否则丢弃（phase 2 不做离线队列）。

- [ ] **Step 1: 写失败测试**（用真 ws 服务器扮演 relay；注入重连延迟为 0 加速）

```ts
import { expect, test } from "bun:test";
import { WebSocketServer } from "ws";

import {
  MSG,
  RELAY_PROTOCOL_VERSION,
  decodeEnvelope,
  encodeEnvelope,
  errorPayload,
  type RelayEnvelope,
} from "../../../../packages/relay-protocol/src/index";
import { RelayClient } from "../../../../packages/channel-relay/src/relay-client";
import type { RelayCredential } from "../../../../packages/channel-relay/src/credential-store";

class MemoryCredentialStore {
  constructor(private value: RelayCredential | null = null) {}
  load() { return this.value; }
  save(credential: RelayCredential) { this.value = credential; }
  clear() { this.value = null; }
}

async function makeFakeRelay(onEnvelope: (envelope: RelayEnvelope, reply: (env: RelayEnvelope) => void, raw: import("ws").WebSocket) => void) {
  const wss = new WebSocketServer({ port: 0 });
  await new Promise<void>((resolve) => wss.on("listening", () => resolve()));
  wss.on("connection", (socket) => {
    socket.on("message", (data) => {
      const decoded = decodeEnvelope(String(data));
      if (decoded.ok) onEnvelope(decoded.envelope, (env) => socket.send(encodeEnvelope(env)), socket);
    });
  });
  return { wss, url: `ws://127.0.0.1:${(wss.address() as { port: number }).port}` };
}

const res = (envelope: RelayEnvelope, payload: unknown): RelayEnvelope => ({
  protocolVersion: RELAY_PROTOCOL_VERSION, kind: "res", id: envelope.id, type: envelope.type, payload,
});

test("registers with pairing token, saves credential, reports ready", async () => {
  const { wss, url } = await makeFakeRelay((envelope, reply) => {
    if (envelope.type === MSG.instanceRegister) {
      expect((envelope.payload as { pairingToken: string }).pairingToken).toBe("pair-1");
      reply(res(envelope, { instanceId: "i-1", credential: "cred-1" }));
    }
  });
  const store = new MemoryCredentialStore();
  const controller = new AbortController();
  const ready = new Promise<void>((resolve) => {
    const client = new RelayClient({
      url, credentialStore: store, pairingToken: "pair-1", coreVersion: "0.11.0",
      onRequest: () => {}, onReady: resolve, reconnectDelaysMs: [0],
    });
    client.start(controller.signal);
  });
  await ready;
  expect(store.load()).toEqual({ instanceId: "i-1", credential: "cred-1", relayUrl: url });
  controller.abort();
  wss.close();
});

test("auths with stored credential, dispatches incoming req to onRequest, sends events", async () => {
  const seen: RelayEnvelope[] = [];
  let instanceSocketSend: ((env: RelayEnvelope) => void) | undefined;
  const { wss, url } = await makeFakeRelay((envelope, reply) => {
    seen.push(envelope);
    if (envelope.type === MSG.instanceAuth) {
      reply(res(envelope, { ok: true }));
      instanceSocketSend = reply;
      // immediately push a control req at the instance
      reply({ protocolVersion: RELAY_PROTOCOL_VERSION, kind: "req", id: "r-1", type: MSG.sessionsList, payload: {} });
    }
  });
  const store = new MemoryCredentialStore({ instanceId: "i-1", credential: "cred-1", relayUrl: url });
  const controller = new AbortController();
  const client = new RelayClient({
    url, credentialStore: store,
    onRequest: (envelope, respond) => {
      if (envelope.type === MSG.sessionsList) respond({ sessions: [] });
    },
    reconnectDelaysMs: [0],
  });
  client.start(controller.signal);
  await new Promise((resolve) => setTimeout(resolve, 200));
  const resEnvelope = seen.find((e) => e.kind === "res" && e.id === "r-1");
  expect(resEnvelope?.payload).toEqual({ sessions: [] });

  client.sendEvent(MSG.instanceEvent, { event: { type: "sessions-changed" } });
  await new Promise((resolve) => setTimeout(resolve, 100));
  expect(seen.some((e) => e.kind === "event" && e.type === MSG.instanceEvent)).toBe(true);
  controller.abort();
  wss.close();
});

test("reconnects after a drop; fatal handshake rejection stops retrying", async () => {
  let connections = 0;
  const { wss, url } = await makeFakeRelay((envelope, reply, raw) => {
    if (envelope.type === MSG.instanceAuth) {
      connections += 1;
      if (connections === 1) {
        reply(res(envelope, { ok: true }));
        setTimeout(() => raw.close(), 20); // drop after handshake -> should reconnect
      } else {
        reply(res(envelope, errorPayload("auth-failed", "bad credential"))); // fatal -> stop
      }
    }
  });
  const store = new MemoryCredentialStore({ instanceId: "i-1", credential: "cred-1", relayUrl: url });
  const controller = new AbortController();
  const client = new RelayClient({ url, credentialStore: store, onRequest: () => {}, reconnectDelaysMs: [0] });
  client.start(controller.signal);
  await new Promise((resolve) => setTimeout(resolve, 400));
  expect(connections).toBe(2); // reconnected once, then stopped after fatal rejection
  controller.abort();
  wss.close();
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `bun test tests/unit/packages/channel-relay/relay-client.test.ts`
Expected: FAIL。

- [ ] **Step 3: 实现 relay-client.ts**

```ts
import WebSocket from "ws";

import {
  MSG,
  RELAY_PROTOCOL_VERSION,
  decodeEnvelope,
  encodeEnvelope,
  isErrorPayload,
  type InstanceRegisterResult,
  type RelayEnvelope,
} from "@ganglion/xacpx-relay-protocol";
import type { AppLogger } from "xacpx/plugin-api";

import type { CredentialStore, RelayCredential } from "./credential-store.js";

export interface RelayClientOptions {
  url: string;
  credentialStore: Pick<CredentialStore, "load" | "save" | "clear">;
  pairingToken?: string;
  instanceName?: string;
  coreVersion?: string;
  onRequest: (envelope: RelayEnvelope, respond: (payload: unknown) => void) => void;
  onReady?: () => void;
  reconnectDelaysMs?: number[];
  createSocket?: (url: string) => WebSocket;
  logger?: AppLogger;
}

const DEFAULT_DELAYS = [1_000, 2_000, 5_000, 10_000, 30_000];
const HANDSHAKE_ID = "handshake-1";

export class RelayClient {
  private socket: WebSocket | null = null;
  private attempts = 0;
  private stopped = false;
  private ready = false;

  constructor(private readonly options: RelayClientOptions) {}

  start(abortSignal: AbortSignal): void {
    abortSignal.addEventListener("abort", () => this.stop(), { once: true });
    if (!abortSignal.aborted) this.connect();
  }

  stop(): void {
    this.stopped = true;
    this.socket?.close();
    this.socket = null;
  }

  sendEvent(type: string, payload: unknown): void {
    if (!this.ready || !this.socket || this.socket.readyState !== WebSocket.OPEN) {
      return; // phase 2: drop while disconnected (no offline queue)
    }
    this.socket.send(encodeEnvelope({ protocolVersion: RELAY_PROTOCOL_VERSION, kind: "event", type, payload }));
  }

  private connect(): void {
    if (this.stopped) return;
    const socket = (this.options.createSocket ?? ((url: string) => new WebSocket(url)))(this.options.url);
    this.socket = socket;
    this.ready = false;

    socket.on("open", () => this.sendHandshake(socket));
    socket.on("message", (data) => this.handleMessage(socket, String(data)));
    socket.on("error", () => { /* close follows; reconnect handled there */ });
    socket.on("close", () => {
      this.ready = false;
      if (this.stopped) return;
      const delays = this.options.reconnectDelaysMs ?? DEFAULT_DELAYS;
      const delay = delays[Math.min(this.attempts, delays.length - 1)] ?? 30_000;
      this.attempts += 1;
      setTimeout(() => this.connect(), delay);
    });
  }

  private sendHandshake(socket: WebSocket): void {
    const credential = this.options.credentialStore.load();
    if (credential) {
      socket.send(encodeEnvelope({
        protocolVersion: RELAY_PROTOCOL_VERSION, kind: "req", id: HANDSHAKE_ID, type: MSG.instanceAuth,
        payload: { instanceId: credential.instanceId, credential: credential.credential, coreVersion: this.options.coreVersion },
      }));
      return;
    }
    if (this.options.pairingToken) {
      socket.send(encodeEnvelope({
        protocolVersion: RELAY_PROTOCOL_VERSION, kind: "req", id: HANDSHAKE_ID, type: MSG.instanceRegister,
        payload: { pairingToken: this.options.pairingToken, name: this.options.instanceName, coreVersion: this.options.coreVersion },
      }));
      return;
    }
    void this.options.logger?.error("relay.no_credentials", "relay channel has neither credential nor pairing token", {});
    this.stopped = true;
    socket.close();
  }

  private handleMessage(socket: WebSocket, raw: string): void {
    const decoded = decodeEnvelope(raw);
    if (!decoded.ok) return;
    const envelope = decoded.envelope;

    if (envelope.kind === "res" && envelope.id === HANDSHAKE_ID) {
      if (isErrorPayload(envelope.payload)) {
        void this.options.logger?.error("relay.handshake_rejected", "relay rejected the handshake; not retrying", {
          code: envelope.payload.error.code,
          message: envelope.payload.error.message,
        });
        this.stopped = true; // fatal: stale credential or used/expired pairing token needs operator action
        socket.close();
        return;
      }
      if (envelope.type === MSG.instanceRegister) {
        const result = envelope.payload as InstanceRegisterResult;
        const credential: RelayCredential = {
          instanceId: result.instanceId, credential: result.credential, relayUrl: this.options.url,
        };
        this.options.credentialStore.save(credential);
      }
      this.ready = true;
      this.attempts = 0;
      this.options.onReady?.();
      return;
    }

    if (envelope.kind === "req") {
      const respond = (payload: unknown) => {
        socket.send(encodeEnvelope({
          protocolVersion: RELAY_PROTOCOL_VERSION, kind: "res", id: envelope.id, type: envelope.type, payload,
        }));
      };
      this.options.onRequest(envelope, respond);
    }
  }
}
```

- [ ] **Step 4: 跑测试确认通过**

Run: `bun test tests/unit/packages/channel-relay/relay-client.test.ts && bun run build:channel-relay`
Expected: 3 PASS。

- [ ] **Step 5: Commit**

```bash
git add packages/channel-relay/src/relay-client.ts tests/unit/packages/channel-relay/relay-client.test.ts
git commit -m "feat(channel-relay): relay WS client with pairing/auth handshake and reconnect"
```

---

### Task 12: control-bridge.ts — RPC 分发 + DTO 映射 + 事件转发（TDD）

**Files:**
- Create: `packages/channel-relay/src/control-bridge.ts`
- Test: `tests/unit/packages/channel-relay/control-bridge.test.ts`

- [ ] **Step 1: 写失败测试**

```ts
import { expect, test } from "bun:test";

import { MSG, RELAY_PROTOCOL_VERSION, type RelayEnvelope } from "../../../../packages/relay-protocol/src/index";
import {
  createControlBridge,
  scheduledTaskToDto,
  subscribeControlEvents,
} from "../../../../packages/channel-relay/src/control-bridge";

const req = (type: string, payload: unknown): RelayEnvelope => ({
  protocolVersion: RELAY_PROTOCOL_VERSION, kind: "req", id: "r-1", type, payload,
});

function makeFakeControl() {
  const calls: Record<string, unknown[]> = {};
  const record = (name: string, args: unknown) => { (calls[name] ??= []).push(args); };
  const listeners: Array<(event: unknown) => void> = [];
  const control = {
    listSessions: () => [{ alias: "a", agent: "claude", workspace: "/ws", transportSession: "t", running: false }],
    createSession: async (alias: string, agent: string, workspace: string) => {
      record("createSession", { alias, agent, workspace });
      return { alias, agent, workspace, transportSession: "t", running: false };
    },
    removeSession: async (alias: string) => { record("removeSession", alias); return { wasActive: false }; },
    prompt: async (input: unknown) => { record("prompt", input); return { ok: true, text: "done" }; },
    cancelTurn: (chatKey: string, alias: string) => { record("cancelTurn", { chatKey, alias }); return true; },
    executeCommand: async (input: unknown) => { record("executeCommand", input); return "output"; },
    listScheduledTasks: (chatKey: string) => [{
      id: "ab12", chat_key: chatKey, session_alias: "a",
      execute_at: "2026-06-14T10:00:00.000Z", message: "m", status: "pending", created_at: "2026-06-13T10:00:00.000Z",
    }],
    createScheduledTask: async (input: { chatKey: string; executeAt: Date }) => {
      record("createScheduledTask", input);
      return {
        id: "cd34", chat_key: input.chatKey, session_alias: "a",
        execute_at: input.executeAt.toISOString(), message: "m", status: "pending", created_at: "2026-06-13T10:00:00.000Z",
      };
    },
    cancelScheduledTask: async () => true,
    listOrchestrationTasks: async () => [{
      taskId: "t1", status: "running", targetAgent: "claude", workspace: "/ws",
      task: "do", summary: "s", createdAt: "x", updatedAt: "y",
      sourceHandle: "h", sourceKind: "human", coordinatorSession: "c", resultText: "",
    }],
    getOrchestrationTask: async () => null,
    cancelOrchestrationTask: async () => ({
      taskId: "t1", status: "cancelled", targetAgent: "claude", workspace: "/ws",
      task: "do", summary: "s", createdAt: "x", updatedAt: "y",
      sourceHandle: "h", sourceKind: "human", coordinatorSession: "c", resultText: "",
    }),
    events: { subscribe: (listener: (event: unknown) => void) => { listeners.push(listener); return () => {}; } },
  };
  return { control, calls, emit: (event: unknown) => listeners.forEach((l) => l(event)) };
}

async function dispatch(bridge: ReturnType<typeof createControlBridge>, envelope: RelayEnvelope): Promise<unknown> {
  return await new Promise((resolve) => bridge(envelope, resolve));
}

test("sessions.list / prompt / command.execute dispatch and shape results", async () => {
  const { control, calls } = makeFakeControl();
  const bridge = createControlBridge(control as never);
  expect(await dispatch(bridge, req(MSG.sessionsList, {}))).toEqual({
    sessions: [{ alias: "a", agent: "claude", workspace: "/ws", transportSession: "t", running: false }],
  });
  const promptResult = await dispatch(bridge, req(MSG.prompt, {
    chatKey: "relay:acct", sessionAlias: "a", text: "hi", senderId: "acct", isOwner: true,
  }));
  expect(promptResult).toEqual({ ok: true, text: "done" });
  expect(calls.prompt?.[0]).toEqual({ chatKey: "relay:acct", sessionAlias: "a", text: "hi", senderId: "acct", isOwner: true });
  expect(await dispatch(bridge, req(MSG.commandExecute, { chatKey: "k", text: "/status", senderId: "acct" }))).toEqual({ output: "output" });
});

test("scheduled list/create map records to camelCase DTOs; executeAt parsed to Date", async () => {
  const { control, calls } = makeFakeControl();
  const bridge = createControlBridge(control as never);
  expect(await dispatch(bridge, req(MSG.scheduledList, { chatKey: "relay:acct" }))).toEqual({
    tasks: [{ id: "ab12", sessionAlias: "a", executeAt: "2026-06-14T10:00:00.000Z", message: "m", status: "pending", createdAt: "2026-06-13T10:00:00.000Z" }],
  });
  await dispatch(bridge, req(MSG.scheduledCreate, {
    chatKey: "relay:acct", sessionAlias: "a", executeAt: "2026-06-14T10:00:00.000Z", message: "m",
  }));
  const createInput = calls.createScheduledTask?.[0] as { executeAt: Date };
  expect(createInput.executeAt instanceof Date).toBe(true);
});

test("unknown type and thrown errors become error payloads", async () => {
  const { control } = makeFakeControl();
  const broken = { ...control, listSessions: () => { throw new Error("boom"); } };
  const bridge = createControlBridge(broken as never);
  expect(await dispatch(bridge, req("control.nope", {}))).toEqual({ error: { code: "unknown-type", message: "unsupported rpc type: control.nope" } });
  expect(await dispatch(bridge, req(MSG.sessionsList, {}))).toEqual({ error: { code: "internal", message: "boom" } });
});

test("subscribeControlEvents forwards events and unsubscribes", () => {
  const { control, emit } = makeFakeControl();
  const sent: Array<{ type: string; payload: unknown }> = [];
  subscribeControlEvents(control as never, (type, payload) => sent.push({ type, payload }));
  emit({ type: "sessions-changed" });
  expect(sent).toEqual([{ type: MSG.instanceEvent, payload: { event: { type: "sessions-changed" } } }]);
});

test("scheduledTaskToDto maps snake_case record", () => {
  expect(scheduledTaskToDto({
    id: "i", chat_key: "k", session_alias: "s", execute_at: "e", message: "m", status: "pending", created_at: "c",
  } as never)).toEqual({ id: "i", sessionAlias: "s", executeAt: "e", message: "m", status: "pending", createdAt: "c" });
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `bun test tests/unit/packages/channel-relay/control-bridge.test.ts`
Expected: FAIL。

- [ ] **Step 3: 实现 control-bridge.ts**

```ts
import {
  MSG,
  errorPayload,
  type CommandExecutePayload,
  type OrchestrationCancelPayload,
  type OrchestrationGetPayload,
  type OrchestrationTaskDto,
  type PromptCancelPayload,
  type PromptPayload,
  type RelayEnvelope,
  type ScheduledCancelPayload,
  type ScheduledCreatePayload,
  type ScheduledListPayload,
  type ScheduledTaskDto,
  type SessionsCreatePayload,
  type SessionsRemovePayload,
} from "@ganglion/xacpx-relay-protocol";
import type { ControlService } from "xacpx/plugin-api";

// Wire mappers live here (not in relay-protocol) so the protocol package stays
// free of xacpx imports. Field lists mirror the "Keep in sync" notes in dtos.ts.
export function scheduledTaskToDto(record: ReturnType<ControlService["listScheduledTasks"]>[number]): ScheduledTaskDto {
  return {
    id: record.id,
    sessionAlias: record.session_alias,
    executeAt: record.execute_at,
    message: record.message,
    status: record.status,
    createdAt: record.created_at,
  };
}

export function orchestrationTaskToDto(
  record: Awaited<ReturnType<ControlService["listOrchestrationTasks"]>>[number],
): OrchestrationTaskDto {
  return {
    taskId: record.taskId,
    status: record.status,
    targetAgent: record.targetAgent,
    workspace: record.workspace,
    task: record.task,
    summary: record.summary,
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
  };
}

export type ControlBridge = (envelope: RelayEnvelope, respond: (payload: unknown) => void) => void;

export function createControlBridge(control: ControlService): ControlBridge {
  return (envelope, respond) => {
    void dispatchControlRequest(control, envelope)
      .then(respond)
      .catch((error: unknown) => {
        respond(errorPayload("internal", error instanceof Error ? error.message : String(error)));
      });
  };
}

async function dispatchControlRequest(control: ControlService, envelope: RelayEnvelope): Promise<unknown> {
  const payload = envelope.payload;
  switch (envelope.type) {
    case MSG.sessionsList:
      return { sessions: control.listSessions() }; // ControlSessionInfo is field-identical to SessionDto
    case MSG.sessionsCreate: {
      const input = payload as SessionsCreatePayload;
      return await control.createSession(input.alias, input.agent, input.workspace);
    }
    case MSG.sessionsRemove: {
      const input = payload as SessionsRemovePayload;
      return await control.removeSession(input.alias);
    }
    case MSG.prompt:
      return await control.prompt(payload as PromptPayload);
    case MSG.promptCancel: {
      const input = payload as PromptCancelPayload;
      return { cancelled: control.cancelTurn(input.chatKey, input.sessionAlias) };
    }
    case MSG.commandExecute: {
      const input = payload as CommandExecutePayload;
      return { output: await control.executeCommand(input) };
    }
    case MSG.scheduledList: {
      const input = payload as ScheduledListPayload;
      return { tasks: control.listScheduledTasks(input.chatKey).map(scheduledTaskToDto) };
    }
    case MSG.scheduledCreate: {
      const input = payload as ScheduledCreatePayload;
      const task = await control.createScheduledTask({
        chatKey: input.chatKey,
        sessionAlias: input.sessionAlias,
        executeAt: new Date(input.executeAt),
        message: input.message,
      });
      return scheduledTaskToDto(task);
    }
    case MSG.scheduledCancel: {
      const input = payload as ScheduledCancelPayload;
      return { cancelled: await control.cancelScheduledTask(input.id, input.chatKey) };
    }
    case MSG.orchestrationList:
      return { tasks: (await control.listOrchestrationTasks()).map(orchestrationTaskToDto) };
    case MSG.orchestrationGet: {
      const input = payload as OrchestrationGetPayload;
      const task = await control.getOrchestrationTask(input.taskId);
      return { task: task ? orchestrationTaskToDto(task) : null };
    }
    case MSG.orchestrationCancel: {
      const input = payload as OrchestrationCancelPayload;
      return orchestrationTaskToDto(await control.cancelOrchestrationTask({ taskId: input.taskId }));
    }
    default:
      return errorPayload("unknown-type", `unsupported rpc type: ${envelope.type}`);
  }
}

export function subscribeControlEvents(
  control: ControlService,
  sendEvent: (type: string, payload: unknown) => void,
): () => void {
  return control.events.subscribe((event) => {
    sendEvent(MSG.instanceEvent, { event });
  });
}
```

- [ ] **Step 4: 跑测试确认通过**

Run: `bun test tests/unit/packages/channel-relay/control-bridge.test.ts && bun run build:channel-relay`
Expected: 5 PASS。

- [ ] **Step 5: Commit**

```bash
git add packages/channel-relay/src/control-bridge.ts tests/unit/packages/channel-relay/control-bridge.test.ts
git commit -m "feat(channel-relay): control bridge dispatch, DTO mappers, event forwarding"
```

---

### Task 13: channel.ts + relay-provider.ts + index.ts（插件成形）（TDD）

**Files:**
- Create: `packages/channel-relay/src/channel.ts`、`src/relay-provider.ts`、`src/index.ts`
- Test: `tests/unit/packages/channel-relay/channel.test.ts`、`tests/unit/packages/channel-relay/provider.test.ts`

- [ ] **Step 1: 写失败测试**

`channel.test.ts`（注入 fake client 工厂验证 start 装配；参考 feishu-start-wiring 风格）：

```ts
import { expect, test } from "bun:test";

import { RelayChannel } from "../../../../packages/channel-relay/src/channel";
import type { RelayCredential } from "../../../../packages/channel-relay/src/credential-store";

class MemoryCredentialStore {
  constructor(private value: RelayCredential | null = null) {}
  load() { return this.value; }
  save(credential: RelayCredential) { this.value = credential; }
  clear() { this.value = null; }
}

function makeStartInput(overrides: Record<string, unknown> = {}) {
  const subscribed: unknown[] = [];
  return {
    input: {
      agent: { chat: async () => ({ text: "" }) },
      abortSignal: new AbortController().signal,
      quota: {} as never,
      logger: { info: async () => {}, error: async () => {}, debug: async () => {} },
      control: {
        events: { subscribe: (listener: unknown) => { subscribed.push(listener); return () => {}; } },
        listSessions: () => [],
      },
      coreVersion: "0.11.0",
      ...overrides,
    },
    subscribed,
  };
}

test("isLoggedIn true with credential or pairing token; logout clears credential", () => {
  const withCredential = new RelayChannel({ url: "ws://h:1" }, {
    credentialStore: new MemoryCredentialStore({ instanceId: "i", credential: "c", relayUrl: "ws://h:1" }),
  });
  expect(withCredential.isLoggedIn()).toBe(true);
  withCredential.logout();
  expect(withCredential.isLoggedIn()).toBe(false);

  const withToken = new RelayChannel({ url: "ws://h:1", pairingToken: "t" }, {
    credentialStore: new MemoryCredentialStore(),
  });
  expect(withToken.isLoggedIn()).toBe(true);
});

test("start requires ChannelStartInput.control and wires client + event subscription", async () => {
  const clientCalls: string[] = [];
  const fakeClient = {
    start: () => clientCalls.push("start"),
    stop: () => clientCalls.push("stop"),
    sendEvent: (type: string) => clientCalls.push(`event:${type}`),
  };
  const channel = new RelayChannel({ url: "ws://h:1", pairingToken: "t" }, {
    credentialStore: new MemoryCredentialStore(),
    createClient: () => fakeClient as never,
  });
  const controller = new AbortController();
  const { input, subscribed } = makeStartInput({ abortSignal: controller.signal });
  const startPromise = channel.start(input as never);
  await new Promise((resolve) => setTimeout(resolve, 10));
  expect(clientCalls).toContain("start");
  expect(subscribed).toHaveLength(1);
  controller.abort();
  await startPromise; // start resolves on abort
  expect(clientCalls).toContain("stop");

  const noControl = new RelayChannel({ url: "ws://h:1", pairingToken: "t" }, { credentialStore: new MemoryCredentialStore() });
  const bad = makeStartInput({ control: undefined });
  await expect(noControl.start(bad.input as never)).rejects.toThrow(/control/);
});

test("notify methods forward as instance notices through the client", async () => {
  const events: Array<{ type: string; payload: unknown }> = [];
  const fakeClient = { start: () => {}, stop: () => {}, sendEvent: (type: string, payload: unknown) => events.push({ type, payload }) };
  const channel = new RelayChannel({ url: "ws://h:1", pairingToken: "t" }, {
    credentialStore: new MemoryCredentialStore(),
    createClient: () => fakeClient as never,
  });
  const controller = new AbortController();
  const { input } = makeStartInput({ abortSignal: controller.signal });
  const startPromise = channel.start(input as never);
  await new Promise((resolve) => setTimeout(resolve, 10));
  await channel.notifyTaskCompletion({ taskId: "t1", summary: "done", resultText: "" } as never);
  await channel.notifyTaskProgress({ taskId: "t1" } as never, "50%");
  await channel.sendCoordinatorMessage({ coordinatorSession: "c", chatKey: "k", text: "hello" });
  expect(events.map((e) => (e.payload as { kind: string }).kind)).toEqual([
    "task-completion", "task-progress", "coordinator-message",
  ]);
  controller.abort();
  await startPromise;
});
```

`provider.test.ts`：

```ts
import { expect, test } from "bun:test";

import { relayCliProvider } from "../../../../packages/channel-relay/src/relay-provider";

test("parseAddArgs accepts --url/--token/--name and rejects unknown flags", () => {
  const parsed = relayCliProvider.parseAddArgs(["--url", "wss://h:8788", "--token", "tok", "--name", "pc"]);
  expect(parsed).toEqual({ ok: true, input: { url: "wss://h:8788", token: "tok", name: "pc" } });
  expect(relayCliProvider.parseAddArgs(["--bogus", "x"]).ok).toBe(false);
  expect(relayCliProvider.parseAddArgs(["--url"]).ok).toBe(false);
});

test("buildDefaultConfig/validateConfig enforce url scheme and required token", () => {
  const config = relayCliProvider.buildDefaultConfig({ url: "ws://h:8788", token: "tok", name: "pc" });
  expect(config).toEqual({
    id: "relay", type: "relay", enabled: true,
    options: { url: "ws://h:8788", pairingToken: "tok", name: "pc" },
  });
  expect(relayCliProvider.validateConfig(config)).toEqual([]);
  expect(relayCliProvider.validateConfig(relayCliProvider.buildDefaultConfig({ token: "tok" }))).toContainEqual(
    expect.objectContaining({ kind: "missing-required-field", flag: "--url" }),
  );
  expect(relayCliProvider.validateConfig(relayCliProvider.buildDefaultConfig({ url: "ws://h", }))).toContainEqual(
    expect.objectContaining({ kind: "missing-required-field", flag: "--token" }),
  );
  expect(relayCliProvider.validateConfig(relayCliProvider.buildDefaultConfig({ url: "https://h", token: "t" }))).toContainEqual(
    expect.objectContaining({ kind: "invalid-config" }),
  );
});

test("renderSummary masks the pairing token", () => {
  const config = relayCliProvider.buildDefaultConfig({ url: "ws://h:8788", token: "very-secret-token" });
  const summary = relayCliProvider.renderSummary(config).join("\n");
  expect(summary).toContain("ws://h:8788");
  expect(summary).not.toContain("very-secret-token");
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `bun test tests/unit/packages/channel-relay/channel.test.ts tests/unit/packages/channel-relay/provider.test.ts`
Expected: FAIL。

- [ ] **Step 3: 实现 channel.ts**

```ts
import {
  MSG,
  type InstanceNoticePayload,
} from "@ganglion/xacpx-relay-protocol";
import type {
  ChannelStartInput,
  CoordinatorMessageInput,
  MessageChannelRuntime,
  OrchestrationTaskRecord,
} from "xacpx/plugin-api";

import { parseRelayChannelConfig, type RelayChannelConfig } from "./config.js";
import { CredentialStore, defaultCredentialPath, type RelayCredential } from "./credential-store.js";
import { createControlBridge, subscribeControlEvents } from "./control-bridge.js";
import { RelayClient, type RelayClientOptions } from "./relay-client.js";

interface CredentialStoreLike {
  load(): RelayCredential | null;
  save(credential: RelayCredential): void;
  clear(): void;
}

interface RelayClientLike {
  start(abortSignal: AbortSignal): void;
  stop(): void;
  sendEvent(type: string, payload: unknown): void;
}

export interface RelayChannelDeps {
  credentialStore?: CredentialStoreLike;
  createClient?: (options: RelayClientOptions) => RelayClientLike;
}

export class RelayChannel implements MessageChannelRuntime {
  readonly id = "relay";
  readonly nativeSessionListFormat = "table" as const;

  private readonly config: RelayChannelConfig;
  private readonly credentials: CredentialStoreLike;
  private client: RelayClientLike | null = null;
  private unsubscribe: (() => void) | null = null;

  constructor(options: Record<string, unknown> | undefined, private readonly deps: RelayChannelDeps = {}) {
    this.config = parseRelayChannelConfig(options);
    this.credentials = deps.credentialStore ?? new CredentialStore(defaultCredentialPath());
  }

  isLoggedIn(): boolean {
    return this.credentials.load() !== null || this.config.pairingToken !== undefined;
  }

  async login(): Promise<string> {
    return "relay channel pairs automatically on start; configure it via: xacpx channel add relay --url <ws-url> --token <pairing-token>";
  }

  logout(): void {
    this.credentials.clear();
  }

  async start(input: ChannelStartInput): Promise<void> {
    if (!input.control) {
      throw new Error("relay channel requires ChannelStartInput.control (xacpx >= 0.11)");
    }
    const bridge = createControlBridge(input.control);
    const client = (this.deps.createClient ?? ((options) => new RelayClient(options)))({
      url: this.config.url,
      credentialStore: this.credentials,
      pairingToken: this.config.pairingToken,
      instanceName: this.config.name,
      coreVersion: input.coreVersion,
      onRequest: bridge,
      logger: input.logger,
    });
    this.client = client;
    this.unsubscribe = subscribeControlEvents(input.control, (type, payload) => client.sendEvent(type, payload));
    client.start(input.abortSignal);

    // Channel convention: start() stays pending until shutdown (see run-console).
    await new Promise<void>((resolve) => {
      if (input.abortSignal.aborted) {
        resolve();
        return;
      }
      input.abortSignal.addEventListener("abort", () => resolve(), { once: true });
    });
    this.stop();
  }

  stop(): void {
    this.unsubscribe?.();
    this.unsubscribe = null;
    this.client?.stop();
    this.client = null;
  }

  async notifyTaskCompletion(task: OrchestrationTaskRecord): Promise<void> {
    this.sendNotice({ kind: "task-completion", taskId: task.taskId, text: task.summary || task.resultText || task.taskId });
  }

  async notifyTaskProgress(task: OrchestrationTaskRecord, text: string): Promise<void> {
    this.sendNotice({ kind: "task-progress", taskId: task.taskId, text });
  }

  async sendCoordinatorMessage(input: CoordinatorMessageInput): Promise<void> {
    this.sendNotice({ kind: "coordinator-message", chatKey: input.chatKey, text: input.text });
  }

  private sendNotice(payload: InstanceNoticePayload): void {
    this.client?.sendEvent(MSG.instanceNotice, payload);
  }
}
```

- [ ] **Step 4: 实现 relay-provider.ts**（helper `takeFlagValue` 从 plugin-api 不可得——核实：plugin-api 导出的是类型；feishu 自带了一份 provider helper 副本。本包内联两个小 helper，避免依赖未导出的实现）

```ts
import type {
  ChannelCliInput,
  ChannelCliIo,
  ChannelCliParseResult,
  ChannelCliProvider,
  ChannelCliValidationIssue,
  ChannelRuntimeConfig,
} from "xacpx/plugin-api";

function stringField(input: ChannelCliInput, key: string): string | undefined {
  const value = input[key];
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

export const relayCliProvider: ChannelCliProvider = {
  type: "relay",
  displayName: "Relay Hub",
  supportsLogin: false,

  parseAddArgs(args: string[]): ChannelCliParseResult {
    const input: ChannelCliInput = {};
    for (let i = 0; i < args.length; i++) {
      const arg = args[i];
      const next = args[i + 1];
      const takeValue = (key: string): string | { error: string } => {
        if (!next || next.startsWith("--")) return { error: `${arg} requires a value` };
        i += 1;
        return next;
      };
      if (arg === "--url" || arg === "--token" || arg === "--name") {
        const value = takeValue(arg);
        if (typeof value !== "string") return { ok: false, message: value.error };
        input[arg.slice(2)] = value;
      } else {
        return { ok: false, message: `unknown flag: ${arg}` };
      }
    }
    return { ok: true, input };
  },

  buildDefaultConfig(input: ChannelCliInput): ChannelRuntimeConfig {
    return {
      id: "relay",
      type: "relay",
      enabled: true,
      options: {
        url: stringField(input, "url"),
        pairingToken: stringField(input, "token"),
        ...(stringField(input, "name") ? { name: stringField(input, "name") } : {}),
      },
    };
  },

  validateConfig(config: ChannelRuntimeConfig): ChannelCliValidationIssue[] {
    const issues: ChannelCliValidationIssue[] = [];
    const options = (config.options ?? {}) as Record<string, unknown>;
    const url = typeof options.url === "string" ? options.url : "";
    if (!url) {
      issues.push({ kind: "missing-required-field", flag: "--url", message: "relay gateway ws(s):// url is required" });
    } else if (!url.startsWith("ws://") && !url.startsWith("wss://")) {
      issues.push({ kind: "invalid-config", message: `url must start with ws:// or wss://, got: ${url}` });
    }
    if (typeof options.pairingToken !== "string" || !options.pairingToken) {
      issues.push({ kind: "missing-required-field", flag: "--token", message: "pairing token is required (generate via the relay: xacpx-relay token new)" });
    }
    return issues;
  },

  renderSummary(config: ChannelRuntimeConfig): string[] {
    const options = (config.options ?? {}) as Record<string, unknown>;
    const lines = [`relay url: ${String(options.url ?? "")}`, "pairing token: ***"];
    if (typeof options.name === "string") lines.push(`instance name: ${options.name}`);
    return lines;
  },

  async promptForMissingFields(input: ChannelCliInput, io: ChannelCliIo): Promise<ChannelCliInput> {
    const completed: ChannelCliInput = { ...input };
    if (!stringField(completed, "url")) {
      const value = (await io.promptText("Relay gateway url (ws://host:8788): ")).trim();
      if (value) completed.url = value;
    }
    if (!stringField(completed, "token")) {
      const value = (await io.promptSecret("Pairing token: ")).trim();
      if (value) completed.token = value;
    }
    return completed;
  },
};
```

- [ ] **Step 5: 实现 index.ts**

```ts
import type { XacpxPlugin } from "xacpx/plugin-api";

import { RelayChannel } from "./channel.js";
import { relayCliProvider } from "./relay-provider.js";

export { RelayChannel } from "./channel.js";
export { relayCliProvider } from "./relay-provider.js";

const plugin: XacpxPlugin = {
  apiVersion: 1,
  name: "@ganglion/xacpx-channel-relay",
  minXacpxVersion: "0.11.0",
  channels: [
    {
      type: "relay",
      factory: (options, deps) => new RelayChannel(options, deps as never),
      cliProvider: relayCliProvider,
    },
  ],
};

export default plugin;
```

- [ ] **Step 6: 跑测试确认通过**

Run: `bun test tests/unit/packages/channel-relay/channel.test.ts tests/unit/packages/channel-relay/provider.test.ts && bun run build:channel-relay && npx tsc --noEmit`
Expected: 全 PASS。

- [ ] **Step 7: Commit**

```bash
git add packages/channel-relay/src tests/unit/packages/channel-relay
git commit -m "feat(channel-relay): channel runtime, CLI provider, and plugin entry"
```

---

### Task 14: 端到端集成测试 + spec 修订 + 文档

**Files:**
- Test: `tests/unit/packages/relay/integration.test.ts`
- Modify: `docs/superpowers/specs/2026-06-13-relay-hub-design.md`
- Create: `docs/relay-module.md`
- Modify: `AGENTS.md`

- [ ] **Step 1: 写集成测试**（真 relay 服务（HTTP 走 app.request 免端口 + 真 ws 网关）+ 真 RelayClient + 真 ControlBridge + fake ControlService：配对 → 凭证落盘 → RPC 经 HTTP 代理往返 → 事件上行）

```ts
import { expect, test } from "bun:test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { WebSocketServer } from "ws";

import { MSG } from "../../../../packages/relay-protocol/src/index";
import { createRelayRuntime } from "../../../../packages/relay/src/server";
import { CredentialStore } from "../../../../packages/channel-relay/src/credential-store";
import { createControlBridge, subscribeControlEvents } from "../../../../packages/channel-relay/src/control-bridge";
import { RelayClient } from "../../../../packages/channel-relay/src/relay-client";

test("pair -> credential persisted -> rpc via http proxy -> event ingestion", async () => {
  const runtime = await createRelayRuntime(":memory:");
  const wss = new WebSocketServer({ port: 0 });
  await new Promise<void>((resolve) => wss.on("listening", () => resolve()));
  wss.on("connection", (socket) => runtime.gateway.handleConnection(socket));
  const wsUrl = `ws://127.0.0.1:${(wss.address() as { port: number }).port}`;

  // admin + login cookie + pairing token (over the real HTTP app)
  runtime.accounts.createAccount("admin", "pw", "admin");
  const loginRes = await runtime.app.request("/api/login", {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ username: "admin", password: "pw" }),
  });
  const cookie = loginRes.headers.get("set-cookie")?.split(";")[0] ?? "";
  const tokenRes = await runtime.app.request("/api/instances/pairing-token", {
    method: "POST", headers: { cookie, "content-type": "application/json" }, body: JSON.stringify({ name: "it-pc" }),
  });
  const { token } = (await tokenRes.json()) as { token: string };

  // fake ControlService driven by the real bridge
  const listeners: Array<(event: unknown) => void> = [];
  const fakeControl = {
    listSessions: () => [{ alias: "backend", agent: "claude", workspace: "/ws", transportSession: "t", running: false }],
    events: { subscribe: (listener: (event: unknown) => void) => { listeners.push(listener); return () => {}; } },
  };

  // real connector pieces
  const credentialPath = join(mkdtempSync(join(tmpdir(), "relay-it-")), "credential.json");
  const credentialStore = new CredentialStore(credentialPath);
  const controller = new AbortController();
  const ready = new Promise<void>((resolve) => {
    const client = new RelayClient({
      url: wsUrl, credentialStore, pairingToken: token, coreVersion: "0.11.0",
      onRequest: createControlBridge(fakeControl as never),
      onReady: resolve, reconnectDelaysMs: [0],
    });
    subscribeControlEvents(fakeControl as never, (type, payload) => client.sendEvent(type, payload));
    client.start(controller.signal);
  });
  await ready;

  // pairing persisted a credential
  expect(credentialStore.load()?.instanceId).toBeTruthy();

  // instance listed online; rpc proxies through to the bridge
  const listRes = await runtime.app.request("/api/instances", { headers: { cookie } });
  const { instances } = (await listRes.json()) as { instances: Array<{ id: string; online: boolean; name: string }> };
  expect(instances[0]?.online).toBe(true);
  expect(instances[0]?.name).toBe("it-pc");

  const rpcRes = await runtime.app.request(`/api/instances/${instances[0]!.id}/rpc`, {
    method: "POST", headers: { cookie, "content-type": "application/json" },
    body: JSON.stringify({ type: MSG.sessionsList, payload: {} }),
  });
  expect(rpcRes.status).toBe(200);
  expect(await rpcRes.json()).toEqual({
    result: { sessions: [{ alias: "backend", agent: "claude", workspace: "/ws", transportSession: "t", running: false }] },
  });

  // control event flows up and refreshes last_seen
  listeners.forEach((listener) => listener({ type: "sessions-changed" }));
  await new Promise((resolve) => setTimeout(resolve, 100));
  const after = (await (await runtime.app.request("/api/instances", { headers: { cookie } })).json()) as {
    instances: Array<{ lastSeenAt: string | null }>;
  };
  expect(after.instances[0]?.lastSeenAt).toBeTruthy();

  controller.abort();
  wss.close();
  runtime.close();
});
```

- [ ] **Step 2: 跑集成测试 + 全量**

Run: `bun test tests/unit/packages/relay/integration.test.ts && npm test`
Expected: 集成 PASS；全量绿。

- [ ] **Step 3: spec 修订**（Read spec 后做三处精准编辑）

1. §4.3 的 CLI 行：把「`xacpx relay connect <wss-url> <pairing-token>` 完成配对与频道配置写入」改为「`xacpx channel add relay --url <ws(s)-url> --token <pairing-token>` 写入频道配置；配对交换发生在首次运行时连接（连接器以 token 注册 → relay 换发长期凭证 → 存 `<xacpx-home>/relay/credential.json`，不进 config.json）。核心 CLI 不支持插件自定义顶级命令，故不提供 `xacpx relay connect`。」§6 配对流程第 2 步同步改为 channel add 形式、第 3 步注明凭证存状态文件。
2. §4.4 增加一句：「SQLite 经 SqlDriver 适配层（Bun→bun:sqlite，Node→node:sqlite，零原生依赖）；HTTP（Hono）与实例 WS 分两个端口（默认 8787/8788）。」
3. §5/§7 的 argon2 字样改为 scrypt（注明：node:crypto 内置、格式含参数可迁移）；§5 的 `messages` 表注明「阶段三实现（聊天回显缓存）」。

- [ ] **Step 4: 写 docs/relay-module.md**（按实际落地内容充实；骨架）

```markdown
# Relay Hub 模块说明（packages/relay + packages/channel-relay）

自托管多实例遥控枢纽。设计 spec：docs/superpowers/specs/2026-06-13-relay-hub-design.md。

## 服务端（@ganglion/xacpx-relay）
- 运行时：Node >= 22.13（node:sqlite）或 Bun >= 1.2（bun:sqlite），SqlDriver 适配层自动选择。
- 两个端口：HTTP API（默认 8787，登录/邀请/实例/RPC 代理）+ 实例 WS 网关（默认 8788）。
- 快速开始：
  1. `xacpx-relay init-admin --username admin --db ./relay.db`
  2. `xacpx-relay start --db ./relay.db`
  3. `xacpx-relay token new --account admin --name home-pc --db ./relay.db`
- 安全：scrypt 密码哈希；所有 token/凭证哈希落盘；登录限流；RPC 代理只放行
  control.* 且服务端覆写 chatKey(`relay:<accountId>`)/senderId/isOwner。

## 连接器（@ganglion/xacpx-channel-relay）
- 安装与配对：
  `xacpx plugin add @ganglion/xacpx-channel-relay`
  `xacpx channel add relay --url ws://<relay-host>:8788 --token <pairing-token>`
  `xacpx restart`
- 首连用配对 token 注册并换发长期凭证，存 `<xacpx-home>/relay/credential.json`
  （weixin 凭证先例；config.json 只存 url/pairingToken）。token 单次有效，
  过期/已用需在 relay 侧重新生成并 `xacpx channel add relay` 更新。
- 桥接面：relay 的 control.* RPC → 核心 ControlService（见 docs/control-module.md）；
  ControlEventBus 事件与编排通知上行为 instance.event / instance.notice。
- 阶段边界：离线不排队（实例离线时 RPC 返回 503）；事件断线期间丢弃；
  Web 看板（阶段三）消费本阶段的 HTTP API 与事件。

## 测试
- 单测按文件跑（tests/unit/packages/relay、tests/unit/packages/channel-relay）；
  run-tests.mjs 会预构建 relay-protocol dist。
- 端到端手工验证 runbook：
  1. `bun run build:packages`
  2. `node packages/relay/dist/cli.js init-admin --username admin --db /tmp/relay.db`
  3. `node packages/relay/dist/cli.js start --db /tmp/relay.db`
  4. `node packages/relay/dist/cli.js token new --account admin --db /tmp/relay.db`
  5. 另一终端：dry-run 或真实 xacpx 安装 channel-relay、channel add、restart，
     然后 curl 登录 + `POST /api/instances/<id>/rpc {"type":"control.sessions.list"}` 验证。
```

- [ ] **Step 5: AGENTS.md 导航**（"Docs to rely on" 列表追加一行，置于 control-module 条目后）

```markdown
- Relay Hub（服务端 + 连接器）: [`docs/relay-module.md`](docs/relay-module.md)
```

- [ ] **Step 6: 终验 + Commit**

Run: `npm test && npx tsc --noEmit && bun run build:packages`
Expected: 全绿。

```bash
git add tests/unit/packages/relay/integration.test.ts docs/superpowers/specs/2026-06-13-relay-hub-design.md docs/relay-module.md AGENTS.md
git commit -m "test(relay): end-to-end pairing/rpc integration; docs and spec amendments"
```

---

## 明确不做（阶段边界，写进文档不写代码）

- `messages` 聊天历史缓存表与前端事件 WS 推送（阶段三，Web 看板一起做）。
- 事件离线队列 / RPC 重放（阶段三按需）。
- `sendScheduledMessage`（可选方法，relay chatKey 在阶段二不产生定时任务投递；省略即声明不支持）。
- relay/channel-relay 的 `publish:*` 脚本与 CI tag 流（发布前补，遵循 channel-<pkg>-vX.Y.Z tag 约定）。
- TLS 终结（部署侧用反代；文档注明生产必须 wss）。

## Self-Review 结论（已执行）

- **Spec 覆盖**：§4.2 协议补全→Task 1；§4.4 服务端（网关/SQLite/HTTP/CLI）→Tasks 2-9；§4.3 连接器（外联/配对/重连/CLI provider/通知）→Tasks 10-13；§5 数据模型→Task 3/5/6（messages 表明确移阶段三）；§6 配对流程→Tasks 6/7/11/13 + 集成测试；§7 安全（WSS 要求/限流/哈希落盘/账号隔离/owner 语义）→Tasks 4/6/8（隔离与覆写有测试）；三处 spec 偏差在 Task 14 修订。
- **占位符**：无 TBD/TODO；「若 tsc 解析不了 node:sqlite」「若 coreHomeDir 签名不同」是带完整备选代码/指令的核验分支，非占位。
- **类型一致性**：MSG 常量名在 Tasks 1/7/8/11/12/13/14 一致；`InstanceStore` 方法名（issuePairingToken/redeemPairingToken/verifyCredential/touch/listByAccount/getOwned/remove）在 6/7/8/9/14 一致；`GatewayForApp`（isOnline/sendRequest）与 InstanceGateway 实际方法一致；`RelayClientOptions`/`RelayClientLike` 在 11/13 一致；`CredentialStore.load/save/clear` 在 10/11/13/14 一致；DTO 映射字段与 dtos.ts 的「Keep in sync」注释一致。
