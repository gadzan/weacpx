# 清理非兼容层 `weacpx` → `xacpx` 实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把仓库非兼容层里残留的 `weacpx` 全部替换为 `xacpx`，完整保留迁移/向后兼容层。

**Architecture:** 主要是改名重构 —— wire 标识、持久化枚举、默认值、公开常量（加别名）、内部符号、文件名。每个 task 用 `npx tsc --noEmit` 兜底找漏引用，行为相关项加显式测试。向后兼容靠：MCP 无持久化（重启即新名）、`source` 枚举值从不被写 + 校验器容忍旧值、公开常量保留 deprecated 别名。

**Tech Stack:** TypeScript、Bun（`bun test <file>`、`npm test` 逐文件 runner、`npx tsc --noEmit`）。

参考 spec：`docs/superpowers/specs/2026-06-05-scrub-weacpx-to-xacpx-design.md`

---

## File Structure（涉及文件总览）

- `src/mcp/weacpx-mcp-server.ts`（wire 名；Task 1；Task 8 改名）
- `src/transport/acpx-queue-owner-launcher.ts`（wire 名 Task 1；内部符号 Task 6）
- `docs/config-reference.md` + `docs/zh/config-reference_zh.md`（Task 1 文档）
- `src/state/types.ts`、`src/transport/types.ts`、`src/state/state-store.ts`（Task 2 source 枚举）
- `src/weixin/api/api.ts`（Task 3 默认 bot agent）
- `src/plugins/compatibility.ts`、`src/plugins/types.ts`、`src/plugin-api.ts`、`src/plugins/validate-plugin.ts`（Task 4 公开常量别名 + Task 5 内部字段）
- `src/commands/command-list.ts`（Task 5 内部常量）
- `src/orchestration/orchestration-ipc.ts`（Task 7 pipe 名）
- `src/mcp/weacpx-mcp-{server,transport,tools}.ts` + 对应测试（Task 8 文件改名 + import 同步）

顺序要点：**Task 8（文件改名）放最后**，使前面各 task 的行号/路径稳定；Task 1 与 Task 6 都动 `acpx-queue-owner-launcher.ts` 但不同行，顺序执行无冲突。

---

## Task 1: MCP 编排 server 线名 `weacpx` → `xacpx`

**Files:**
- Modify: `src/mcp/weacpx-mcp-server.ts:86`
- Modify: `src/transport/acpx-queue-owner-launcher.ts:70`
- Modify: `docs/config-reference.md:131`、`docs/zh/config-reference_zh.md:120`
- Test: `tests/unit/mcp/weacpx-mcp-server.test.ts`、`tests/unit/transport/acpx-queue-owner-launcher.test.ts`

- [ ] **Step 1: 先看现有测试对线名/前缀的断言**

Run: `command grep -rniE "name.*weacpx|mcp__weacpx|\"weacpx\"" tests/unit/mcp tests/unit/transport/acpx-queue-owner-launcher.test.ts`
记录所有断言 `"weacpx"`（server 名）或 `mcp__weacpx__*` 的行，Step 4 要同步改成 `xacpx` / `mcp__xacpx__*`。

- [ ] **Step 2: 改两处 wire 名**

`src/mcp/weacpx-mcp-server.ts:86`：
```ts
      name: "xacpx",
```
（原 `name: "weacpx",`，在 `new Server({ name: ..., version: readVersion() }, ...)` 内）

`src/transport/acpx-queue-owner-launcher.ts:70`（`buildWeacpxMcpServerSpec` 返回对象内）：
```ts
    name: "xacpx",
```
（原 `name: "weacpx",`）

- [ ] **Step 3: 改文档**

`docs/config-reference.md:131` 与 `docs/zh/config-reference_zh.md:120`：把名为 `weacpx` 的 MCP server 改为 `xacpx`，示例 `mcp__weacpx__delegate_request` / `mcp__weacpx__scheduled_create` 改为 `mcp__xacpx__delegate_request` / `mcp__xacpx__scheduled_create`，前缀 `mcp__weacpx__*` → `mcp__xacpx__*`。

- [ ] **Step 4: 同步 Step 1 找到的测试断言**

把那些断言里的 server 名 `"weacpx"` → `"xacpx"`、`mcp__weacpx__` → `mcp__xacpx__`。

- [ ] **Step 5: 跑测试 + 类型检查**

Run: `bun test tests/unit/mcp/weacpx-mcp-server.test.ts tests/unit/transport/acpx-queue-owner-launcher.test.ts`
Expected: PASS。
Run: `npx tsc --noEmit`
Expected: 通过。

- [ ] **Step 6: Commit**

```bash
git add src/mcp/weacpx-mcp-server.ts src/transport/acpx-queue-owner-launcher.ts docs/config-reference.md docs/zh/config-reference_zh.md tests/unit/mcp/weacpx-mcp-server.test.ts tests/unit/transport/acpx-queue-owner-launcher.test.ts
git commit -m "refactor(mcp): rename orchestration MCP server wire name weacpx -> xacpx"
```

---

## Task 2: 持久化 `source` 枚举 `"weacpx"` → `"xacpx"`（校验器容忍旧值）

**Files:**
- Modify: `src/state/types.ts:4`
- Modify: `src/transport/types.ts:32`
- Modify: `src/state/state-store.ts:437`
- Test: `tests/unit/state/state-store.test.ts`（已存在，追加用例）

背景：`StateStore(path)` 从文件读取并校验；`isSessionSource`（私有）参与 `isSessionRecord`，若 source 非法则**整条 session 记录被丢弃**。所以「新值被接受」= 带该 source 的 session 在 `load()` 后仍存在。

- [ ] **Step 1: 追加回归测试**

在 `tests/unit/state/state-store.test.ts` 末尾追加（文件顶部已 import `mkdtemp, rm, join, tmpdir, StateStore, expect, test`，无需新增 import）：

```ts
test("load keeps sessions with legacy source 'weacpx' and new source 'xacpx'", async () => {
  const dir = await mkdtemp(join(tmpdir(), "weacpx-state-"));
  const path = join(dir, "state.json");
  const store = new StateStore(path);

  await Bun.write(
    path,
    JSON.stringify({
      sessions: {
        "w:legacy": {
          alias: "w:legacy", agent: "codex", workspace: "w", transport_session: "w:legacy",
          source: "weacpx", created_at: "2026-01-01T00:00:00.000Z", last_used_at: "2026-01-01T00:00:00.000Z",
        },
        "w:fresh": {
          alias: "w:fresh", agent: "codex", workspace: "w", transport_session: "w:fresh",
          source: "xacpx", created_at: "2026-01-01T00:00:00.000Z", last_used_at: "2026-01-01T00:00:00.000Z",
        },
      },
      chat_contexts: {},
      orchestration: { tasks: {}, workerBindings: {}, groups: {} },
    }),
  );

  const state = await store.load();
  expect(state.sessions["w:legacy"]?.source).toBe("weacpx");
  expect(state.sessions["w:fresh"]?.source).toBe("xacpx");

  await rm(dir, { recursive: true, force: true });
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `bun test tests/unit/state/state-store.test.ts`
Expected: FAIL —— `"xacpx"` 当前被 `isSessionSource` 判为非法，`w:fresh` 记录被丢弃，`state.sessions["w:fresh"]` 为 undefined，断言失败。（`w:legacy` 仍在，因为 `"weacpx"` 当前被接受。）

- [ ] **Step 3: 改枚举 + 校验器**

`src/state/types.ts:4`：
```ts
export type LogicalSessionSource = "xacpx" | "agent-side";
```
`src/transport/types.ts:32`：
```ts
  source?: "xacpx" | "agent-side";
```
`src/state/state-store.ts:437`（`isSessionSource`，**同时容忍 legacy `"weacpx"`**）：
```ts
function isSessionSource(value: unknown): value is AppState["sessions"][string]["source"] {
  return value === undefined || value === "weacpx" || value === "xacpx" || value === "agent-side";
}
```

- [ ] **Step 4: 跑测试 + 类型检查**

Run: `bun test tests/unit/state/state-store.test.ts`
Expected: PASS。
Run: `npx tsc --noEmit`
Expected: 通过（确认没有别处依赖 `source === "weacpx"` 的类型收窄）。

- [ ] **Step 5: Commit**

```bash
git add src/state/types.ts src/transport/types.ts src/state/state-store.ts tests/unit/state/state-store.test.ts
git commit -m "refactor(state): rename session source enum weacpx -> xacpx (load still accepts legacy)"
```

---

## Task 3: 默认 bot agent `DEFAULT_BOT_AGENT` → `"xacpx"`

**Files:**
- Modify: `src/weixin/api/api.ts:60`
- Test: `tests/unit/weixin/api.test.ts`、`tests/unit/weixin/api/base-info.test.ts`

- [ ] **Step 1: 找现有断言**

Run: `command grep -rniE "weacpx|DEFAULT_BOT_AGENT" tests/unit/weixin/api.test.ts tests/unit/weixin/api/base-info.test.ts`
记录所有断言默认 agent 名为 `"weacpx"` 的行。

- [ ] **Step 2: 改默认值**

`src/weixin/api/api.ts:60`：
```ts
const DEFAULT_BOT_AGENT = "xacpx";
```

- [ ] **Step 3: 同步测试断言**

把 Step 1 找到的 `"weacpx"` 期望值改为 `"xacpx"`。

- [ ] **Step 4: 跑测试 + 类型检查**

Run: `bun test tests/unit/weixin/api.test.ts tests/unit/weixin/api/base-info.test.ts`
Expected: PASS。
Run: `npx tsc --noEmit`
Expected: 通过。

- [ ] **Step 5: Commit**

```bash
git add src/weixin/api/api.ts tests/unit/weixin/api.test.ts tests/unit/weixin/api/base-info.test.ts
git commit -m "refactor(weixin): default bot agent weacpx -> xacpx"
```

---

## Task 4: 公开插件常量 —— 新增 `XACPX_*` 规范名，保留 `WEACPX_*` 为 deprecated 别名

**Files:**
- Modify: `src/plugins/compatibility.ts:8-13` + `:123-124`
- Modify: `src/plugins/types.ts:1-12`
- Modify: `src/plugin-api.ts:28-32`
- Modify: `src/plugins/validate-plugin.ts:4,70`
- Test: `tests/unit/plugins/plugin-compatibility.test.ts`

- [ ] **Step 1: 写新断言（先失败）**

在 `tests/unit/plugins/plugin-compatibility.test.ts` 顶部 import 增加 `XACPX_PLUGIN_API_VERSION, XACPX_PLUGIN_API_SUPPORTED_VERSIONS, XACPX_PLUGIN_MIN_CORE_VERSION`（与现有 `WEACPX_*` import 同源），并追加：
```ts
test("XACPX_* plugin constants are the canonical names and equal the deprecated WEACPX_* aliases", () => {
  expect(XACPX_PLUGIN_API_VERSION).toBe(WEACPX_PLUGIN_API_VERSION);
  expect(XACPX_PLUGIN_API_SUPPORTED_VERSIONS).toEqual(WEACPX_PLUGIN_API_SUPPORTED_VERSIONS);
  expect(XACPX_PLUGIN_MIN_CORE_VERSION).toBe(WEACPX_PLUGIN_MIN_CORE_VERSION);
  expect(XACPX_PLUGIN_API_SUPPORTED_VERSIONS).toContain(XACPX_PLUGIN_API_VERSION);
  expect(XACPX_PLUGIN_MIN_CORE_VERSION).toBe("0.5.0");
});
```
（保留文件中已有的 `WEACPX_*` 断言不动 —— 它们验证别名仍可用。）

- [ ] **Step 2: 跑测试确认失败**

Run: `bun test tests/unit/plugins/plugin-compatibility.test.ts`
Expected: FAIL（`XACPX_PLUGIN_API_VERSION` 尚未导出）。

- [ ] **Step 3: compatibility.ts 定义规范名 + 别名**

替换 `src/plugins/compatibility.ts:8-13`：
```ts
export const XACPX_PLUGIN_API_VERSION = 1 as const;
export const XACPX_PLUGIN_API_SUPPORTED_VERSIONS: readonly number[] = [1];

// Minimum core version that the current plugin API version corresponds to.
// First-party plugins should declare `minXacpxVersion` >= this value.
export const XACPX_PLUGIN_MIN_CORE_VERSION = "0.5.0" as const;

// Deprecated weacpx→xacpx aliases — kept for already-published plugins that
// import the old names from "xacpx/plugin-api".
export const WEACPX_PLUGIN_API_VERSION = XACPX_PLUGIN_API_VERSION;
export const WEACPX_PLUGIN_API_SUPPORTED_VERSIONS = XACPX_PLUGIN_API_SUPPORTED_VERSIONS;
export const WEACPX_PLUGIN_MIN_CORE_VERSION = XACPX_PLUGIN_MIN_CORE_VERSION;
```
`src/plugins/compatibility.ts:123-124` 内部引用改用规范名：
```ts
  if (!XACPX_PLUGIN_API_SUPPORTED_VERSIONS.includes(apiVersion)) {
    const supported = XACPX_PLUGIN_API_SUPPORTED_VERSIONS.join(", ");
```

- [ ] **Step 4: types.ts 同时 re-export 新旧名**

替换 `src/plugins/types.ts:2-12` 的 import/export 块，使其导入并 re-export 全部六个名字：
```ts
import {
  XACPX_PLUGIN_API_VERSION,
  XACPX_PLUGIN_API_SUPPORTED_VERSIONS,
  XACPX_PLUGIN_MIN_CORE_VERSION,
  WEACPX_PLUGIN_API_VERSION,
  WEACPX_PLUGIN_API_SUPPORTED_VERSIONS,
  WEACPX_PLUGIN_MIN_CORE_VERSION,
} from "./compatibility.js";

export {
  XACPX_PLUGIN_API_VERSION,
  XACPX_PLUGIN_API_SUPPORTED_VERSIONS,
  XACPX_PLUGIN_MIN_CORE_VERSION,
  WEACPX_PLUGIN_API_VERSION,
  WEACPX_PLUGIN_API_SUPPORTED_VERSIONS,
  WEACPX_PLUGIN_MIN_CORE_VERSION,
};
```

- [ ] **Step 5: plugin-api.ts 公开导出新旧名**

`src/plugin-api.ts:28-32` 的 export 块改为同时导出新旧名（保留 `WeacpxPlugin, XacpxPlugin` 类型行不动）：
```ts
export {
  XACPX_PLUGIN_API_VERSION,
  XACPX_PLUGIN_API_SUPPORTED_VERSIONS,
  XACPX_PLUGIN_MIN_CORE_VERSION,
  WEACPX_PLUGIN_API_VERSION,
  WEACPX_PLUGIN_API_SUPPORTED_VERSIONS,
  WEACPX_PLUGIN_MIN_CORE_VERSION,
} from "./plugins/types.js";
```

- [ ] **Step 6: validate-plugin.ts 内部引用改规范名**

`src/plugins/validate-plugin.ts:4`：
```ts
import { XACPX_PLUGIN_API_VERSION } from "./types.js";
```
`src/plugins/validate-plugin.ts:70`：
```ts
    apiVersion: XACPX_PLUGIN_API_VERSION,
```

- [ ] **Step 7: 跑测试 + 类型检查**

Run: `bun test tests/unit/plugins/plugin-compatibility.test.ts tests/unit/plugins/plugin-cli.test.ts`
Expected: PASS（含 plugin-cli 那条用 `WEACPX_PLUGIN_API_VERSION` 的夹具 —— 别名仍可用）。
Run: `npx tsc --noEmit`
Expected: 通过。

- [ ] **Step 8: Commit**

```bash
git add src/plugins/compatibility.ts src/plugins/types.ts src/plugin-api.ts src/plugins/validate-plugin.ts tests/unit/plugins/plugin-compatibility.test.ts
git commit -m "feat(plugins): add canonical XACPX_PLUGIN_* constants, keep WEACPX_* as deprecated aliases"
```

---

## Task 5: 内部标识改名（无公开 re-export）

**Files:**
- Modify: `src/commands/command-list.ts:1`（+ 第 32 行用点）
- Modify: `src/plugins/compatibility.ts`（`currentWeacpxVersion` 字段 + 错误消息标签）
- Test: 由 `tsc` + 既有测试兜底

- [ ] **Step 1: 重命名 `WEACPX_KNOWN_COMMAND_PREFIXES`**

确认无外部引用：Run `command grep -rn "WEACPX_KNOWN_COMMAND_PREFIXES" src tests`（预期只在 `src/commands/command-list.ts:1` 定义、`:32` 使用）。
在 `src/commands/command-list.ts` 把该常量名改为 `XACPX_KNOWN_COMMAND_PREFIXES`（定义处 `:1` 与第 32 行 `new Set<string>(XACPX_KNOWN_COMMAND_PREFIXES)`）。若 Step 1 grep 发现别处引用，一并改。

- [ ] **Step 2: 重命名 `currentWeacpxVersion` 上下文字段**

Run `command grep -rn "currentWeacpxVersion" src tests`（预期只在 `src/plugins/compatibility.ts`）。把该字段名全部改为 `currentXacpxVersion`（含 interface 定义、解构、`compareSemver` 入参、以及错误消息里作为实参传入的位置）。错误消息里若有英文/中文「weacpx」字样标签随手改为「xacpx」（仅日志/报错文案，不影响逻辑）。

- [ ] **Step 3: 类型检查 + 相关测试**

Run: `npx tsc --noEmit`
Expected: 通过（漏改的引用会在此暴露）。
Run: `bun test tests/unit/plugins/plugin-compatibility.test.ts tests/unit/commands/parse-command.test.ts`
Expected: PASS。

- [ ] **Step 4: Commit**

```bash
git add src/commands/command-list.ts src/plugins/compatibility.ts
git commit -m "refactor: rename internal weacpx identifiers (command prefixes, compat ctx field)"
```

---

## Task 6: `acpx-queue-owner-launcher` 内部符号改名

**Files:**
- Modify: `src/transport/acpx-queue-owner-launcher.ts`（`weacpxCommand` 字段、`buildWeacpxMcpServerSpec`、`resolveDefaultWeacpxCommand`）
- Test: `tests/unit/transport/acpx-queue-owner-launcher.test.ts`

- [ ] **Step 1: 确认引用范围**

Run: `command grep -rn "buildWeacpxMcpServerSpec\|resolveDefaultWeacpxCommand\|weacpxCommand" src tests`
预期仅 `src/transport/acpx-queue-owner-launcher.ts` 与 `tests/unit/transport/acpx-queue-owner-launcher.test.ts`。

- [ ] **Step 2: 改名（保持值/行为不变）**

在 `src/transport/acpx-queue-owner-launcher.ts`：
- `buildWeacpxMcpServerSpec` → `buildXacpxMcpServerSpec`（导出函数定义 `:63` 与调用 `:155`）。
- 选项字段 `weacpxCommand` → `xacpxCommand`（interface `:47`、`buildXacpxMcpServerSpec` 入参 `:64/:68`、类字段 `:109`、赋值 `:120`、传参 `:156`）。
- `resolveDefaultWeacpxCommand` → `resolveDefaultXacpxCommand`（定义 `:276` 与调用 `:120`）。

在 `tests/unit/transport/acpx-queue-owner-launcher.test.ts`：
- import `buildWeacpxMcpServerSpec` → `buildXacpxMcpServerSpec`（`:4`），调用处（`:12/:24/:191`）同步；传参里的 `weacpxCommand:` 键改 `xacpxCommand:`。
- 注意：Task 1 已把该 spec 返回的 `name` 改成 `"xacpx"`；本任务只动符号名，不要回改 `name`。

- [ ] **Step 3: 跑测试 + 类型检查**

Run: `bun test tests/unit/transport/acpx-queue-owner-launcher.test.ts`
Expected: PASS。
Run: `npx tsc --noEmit`
Expected: 通过。

- [ ] **Step 4: Commit**

```bash
git add src/transport/acpx-queue-owner-launcher.ts tests/unit/transport/acpx-queue-owner-launcher.test.ts
git commit -m "refactor(transport): rename internal weacpx symbols in queue-owner launcher"
```

---

## Task 7: orchestration pipe 名 `weacpx-orchestration-` → `xacpx-orchestration-`

**Files:**
- Modify: `src/orchestration/orchestration-ipc.ts:127`
- Test: `tests/unit/` 中若有断言 pipe 路径的用例（Step 1 查）

- [ ] **Step 1: 查 pipe 路径断言**

Run: `command grep -rn "weacpx-orchestration" src tests`
预期只有 `src/orchestration/orchestration-ipc.ts:127`（server/client 都经 `resolveOrchestrationEndpoint` 取路径）。若测试里有断言则记录。

- [ ] **Step 2: 改 pipe 名**

`src/orchestration/orchestration-ipc.ts:127`：
```ts
      path: `\\\\.\\pipe\\xacpx-orchestration-${suffix}`,
```

- [ ] **Step 3: 同步断言（若有）+ 类型检查 + 相关测试**

若 Step 1 发现测试断言，改成 `xacpx-orchestration-`。
Run: `npx tsc --noEmit` → 通过。
Run: `command grep -rln "orchestration-ipc\|resolveOrchestrationEndpoint" tests` 找到的测试文件逐个 `bun test <file>` → PASS。

- [ ] **Step 4: Commit**

```bash
git add src/orchestration/orchestration-ipc.ts
git commit -m "refactor(orchestration): rename windows pipe weacpx-orchestration -> xacpx-orchestration"
```

---

## Task 8: 文件重命名 `weacpx-mcp-*.ts` → `xacpx-mcp-*.ts`（最后做）

**Files:**
- Rename: `src/mcp/weacpx-mcp-server.ts` → `src/mcp/xacpx-mcp-server.ts`
- Rename: `src/mcp/weacpx-mcp-transport.ts` → `src/mcp/xacpx-mcp-transport.ts`
- Rename: `src/mcp/weacpx-mcp-tools.ts` → `src/mcp/xacpx-mcp-tools.ts`
- Rename: `tests/unit/mcp/weacpx-mcp-{server,transport,tools}.test.ts` → `xacpx-mcp-*.test.ts`
- Modify importers: `src/cli.ts:21,30`、`src/mcp/xacpx-mcp-server.ts:27,28`、`src/mcp/xacpx-mcp-tools.ts:2`，及上述测试文件内 import 路径

- [ ] **Step 1: `git mv` 源文件与测试文件**

```bash
git mv src/mcp/weacpx-mcp-server.ts src/mcp/xacpx-mcp-server.ts
git mv src/mcp/weacpx-mcp-transport.ts src/mcp/xacpx-mcp-transport.ts
git mv src/mcp/weacpx-mcp-tools.ts src/mcp/xacpx-mcp-tools.ts
git mv tests/unit/mcp/weacpx-mcp-server.test.ts tests/unit/mcp/xacpx-mcp-server.test.ts
git mv tests/unit/mcp/weacpx-mcp-transport.test.ts tests/unit/mcp/xacpx-mcp-transport.test.ts
git mv tests/unit/mcp/weacpx-mcp-tools.test.ts tests/unit/mcp/xacpx-mcp-tools.test.ts
```

- [ ] **Step 2: 更新所有 import 路径**

Run: `command grep -rn "weacpx-mcp-server\|weacpx-mcp-transport\|weacpx-mcp-tools" src tests`
把每处 `./weacpx-mcp-server` / `./mcp/weacpx-mcp-transport` / `../../../src/mcp/weacpx-mcp-tools` 等路径中的 `weacpx-mcp-` 改为 `xacpx-mcp-`。已知点：
- `src/cli.ts:21` `./mcp/weacpx-mcp-server` → `./mcp/xacpx-mcp-server`
- `src/cli.ts:30` `./mcp/weacpx-mcp-transport` → `./mcp/xacpx-mcp-transport`
- `src/mcp/xacpx-mcp-server.ts:27` `./weacpx-mcp-tools` → `./xacpx-mcp-tools`
- `src/mcp/xacpx-mcp-server.ts:28` `./weacpx-mcp-transport` → `./xacpx-mcp-transport`
- `src/mcp/xacpx-mcp-tools.ts:2` `./weacpx-mcp-transport` → `./xacpx-mcp-transport`
- 三个改名后的测试文件内的 `../../../src/mcp/weacpx-mcp-*` import → `xacpx-mcp-*`

> 不要改 `tests/unit/transport/streaming-prompt.test.ts:175/177/183` 里的字符串 `weacpx-mcp-server.ts` —— 那是测试 tool-event 渲染用的**示例文件路径文本**，不是 import，保持原样（属历史/示例文本）。

- [ ] **Step 3: 类型检查 + 跑改名后的测试**

Run: `npx tsc --noEmit`
Expected: 通过（漏改的 import 会在此暴露）。
Run: `bun test tests/unit/mcp/xacpx-mcp-server.test.ts tests/unit/mcp/xacpx-mcp-transport.test.ts tests/unit/mcp/xacpx-mcp-tools.test.ts`
Expected: PASS。

- [ ] **Step 4: Commit**

```bash
git add -A src/mcp src/cli.ts tests/unit/mcp
git commit -m "refactor(mcp): rename weacpx-mcp-*.ts files to xacpx-mcp-*.ts"
```
> 例外：本任务因含 `git mv` + 多文件路径改，允许对 `src/mcp` / `tests/unit/mcp` 目录用 `git add -A <dir>`，但务必先 `git status` 确认只含本任务的改名与 import 改动，不夹带其它。

---

## 收尾校验

- [ ] **全量类型检查**：`npx tsc --noEmit` 通过。
- [ ] **全量测试**：`npm test`（逐文件 runner），退出码 0。
- [ ] **复核「留」清单未被动**：`command grep -rn "weacpx" src/runtime/core-env.ts src/runtime/migrate-core-home.ts src/cli-update.ts src/plugins/plugin-home.ts src/plugins/plugin-renames.ts` 应仍有预期的 weacpx 兼容引用；插件元数据读取 `minWeacpxVersion`（`compatibility.ts:136/154`）仍在；`WeacpxPlugin` 公开别名仍导出。
- [ ] **构建**：`bun run build`。

## Self-Review 备注（spec 覆盖）

- spec 改项 1（MCP 线名两处+文档）→ Task 1；2（source 枚举+校验容忍）→ Task 2；3（DEFAULT_BOT_AGENT）→ Task 3；4（公开常量加别名）→ Task 4；5/6（内部标识：命令前缀常量、compat 字段）→ Task 5；7（queue-owner 内部符号）→ Task 6；8（pipe 名）→ Task 7；文件改名 → Task 8。
- spec「留」清单 → 收尾校验里显式复核未动。
- 命名一致性：`XACPX_PLUGIN_API_VERSION` 等在 compatibility/types/plugin-api 三处一致导出；`buildXacpxMcpServerSpec`/`xacpxCommand`/`resolveDefaultXacpxCommand` 在 Task 6 内自洽；Task 1 改 `name` 值、Task 6 改函数名，互不回改。
- 无占位符：每个改动步骤给出确切 old→new 与命令；少数「先 grep 确认引用范围」的步骤是纯改名的安全前置，配 `tsc` 兜底。
