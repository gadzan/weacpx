# 清理非兼容层的 `weacpx` → `xacpx` — 设计文档

- 日期：2026-06-05
- 分支：`chore/scrub-weacpx-to-xacpx`
- 状态：已通过 brainstorming 评审，待写实现计划

## 背景

`weacpx` → `xacpx` 的包级改名已于 0.8.0 完成并发布（main 上 `c4af0c2` + `8e1a7a5`，当前 `0.9.1`，npm 包 `@ganglion/xacpx`，bin `xacpx`，GitHub 仓库已是 `gadzan/xacpx`）。但 `src/` 中仍有 ~46 个文件包含 `weacpx`，分两类：

1. **刻意保留的兼容/迁移层**（动了会破坏老用户/老插件/老 state）。
2. **当初收口 0.8.0 时未清理的非兼容残留**（wire 名、内部标识、文件名）—— 本设计只处理这一类。

经核对源码，第 2 类里几个看似「高风险」的项其实影响很小（详见下文「关键事实」），可以安全替换。本设计**不碰**第 1 类。

## 关键事实（已核对源码）

- **MCP 编排 server 线名**只来自两处赋值：`src/mcp/weacpx-mcp-server.ts:86` 的 `name: "weacpx"` 与 `src/transport/acpx-queue-owner-launcher.ts:70` 的 `name: "weacpx"`（后者进 `ACPX_QUEUE_OWNER_PAYLOAD`）。acpx 据此拼出工具前缀 `mcp__weacpx__*`。全仓除文档/CHANGELOG 外**无任何代码/配置/state 硬编码该前缀**；该 server 每次发 prompt 前临时启动、无持久化引用。→ 改线名 + 重启 daemon 即生效，仓库内零迁移；唯一受影响的是仓库外硬编码了旧前缀的 agent（用户已同意忽略）。
- **持久化 `source` 枚举**：`LogicalSessionSource = "weacpx" | "agent-side"`（`src/state/types.ts:4`，`src/transport/types.ts:32`）。字面量 `"weacpx"` **从不被写入**——普通会话经 `createLogicalSession` 写 `source: undefined`，native 会话写 `"agent-side"`（`src/sessions/session-service.ts:140`）。逻辑判断只有 `=== "agent-side"` / `!== "agent-side"`，**没有任何分支判断 `=== "weacpx"`**。`"weacpx"` 仅出现在类型联合与加载校验器 `isSessionSource`（`src/state/state-store.ts:437`，接受 `undefined | "weacpx" | "agent-side"`）。→ 重命名该枚举成员零数据迁移，只需让校验器同时容忍 legacy `"weacpx"`。
- **插件元数据**已向前兼容：`src/plugins/compatibility.ts:136/154` 读 `minXacpxVersion ?? minWeacpxVersion`（缺失则跳过校验，不报错）。→ 本设计保留对老字段的**容忍读取**，只改内部常量/参数名。
- `DEFAULT_BOT_AGENT = "weacpx"`（`src/weixin/api/api.ts:60`）：空输入时返回的默认 bot agent 名，是默认 fallback 值。→ 用户已确认改为 `"xacpx"`。
- orchestration pipe 名 `\\.\pipe\weacpx-orchestration-${suffix}`（`src/orchestration/orchestration-ipc.ts:127`）：Windows 命名管道路径，server/client 经同一 helper 计算，运行时无持久化。→ 原子改名安全。

## 目标

把**非兼容层**的 `weacpx` 全部替换为 `xacpx`，同时**完整保留**迁移/向后兼容层。

## 范围

### 改（IN SCOPE）

**B 档（有 wire/状态/默认值语义）**

1. **MCP 编排 server 线名 `weacpx` → `xacpx`**（工具前缀随之变 `mcp__xacpx__*`）：
   - `src/mcp/weacpx-mcp-server.ts:86` `name: "weacpx"` → `"xacpx"`。
   - `src/transport/acpx-queue-owner-launcher.ts:70` `name: "weacpx"` → `"xacpx"`（两处必须一致）。
   - 文档：`docs/config-reference.md:131`、`docs/zh/config-reference_zh.md:120` 中的 `weacpx` MCP server 名与 `mcp__weacpx__*` 示例更新为 `xacpx` / `mcp__xacpx__*`。
   - 测试：更新任何断言 `mcp__weacpx__*` 或 server 名 `weacpx` 的用例。

2. **持久化 `source` 枚举 `"weacpx"` → `"xacpx"`**：
   - `src/state/types.ts:4` `LogicalSessionSource = "xacpx" | "agent-side"`。
   - `src/transport/types.ts:32` `source?: "xacpx" | "agent-side"`。
   - `src/state/state-store.ts:437` `isSessionSource`：**同时**接受 `undefined`、legacy `"weacpx"`、新 `"xacpx"`、`"agent-side"`（向后兼容旧 `state.json`）。
   - 不需要数据迁移（值从不被写）。

3. **`DEFAULT_BOT_AGENT = "weacpx"` → `"xacpx"`**（`src/weixin/api/api.ts:60`）。

**A 档（纯内部，零运行时风险）**

4. **文件重命名** `src/mcp/weacpx-mcp-server.ts` / `weacpx-mcp-transport.ts` / `weacpx-mcp-tools.ts` → `xacpx-mcp-server.ts` / `xacpx-mcp-transport.ts` / `xacpx-mcp-tools.ts`，并更新所有 import 路径（用 `git mv` 保留历史）。对应测试文件 `tests/unit/mcp/weacpx-mcp-transport.test.ts` 等也一并重命名 + 更新 import。

5. **公开插件常量：新增 `XACPX_*` 别名、保留旧名**（核对发现 `WEACPX_PLUGIN_API_VERSION` / `WEACPX_PLUGIN_API_SUPPORTED_VERSIONS` / `WEACPX_PLUGIN_MIN_CORE_VERSION` 经 `src/plugin-api.ts:28-32` **公开 re-export**，插件作者会 `import ... from "xacpx/plugin-api"`，并非内部）：
   - 在 `src/plugins/compatibility.ts` 定义规范名 `XACPX_PLUGIN_API_VERSION` / `XACPX_PLUGIN_API_SUPPORTED_VERSIONS` / `XACPX_PLUGIN_MIN_CORE_VERSION`，并保留 `WEACPX_PLUGIN_*` 作为指向同值的 **deprecated 别名**。
   - `src/plugins/types.ts` 与 `src/plugin-api.ts` 同时 re-export 新名与旧名。
   - 内部引用（`compatibility.ts:123-124`、`validate-plugin.ts:70`）改用 `XACPX_*`。
   - **无插件脚手架需要改**：`plugin-cli.ts` 不生成示例代码；`plugin-cli.test.ts:146` 里 `import { WEACPX_PLUGIN_API_VERSION } from "xacpx/plugin-api"` 是测试**夹具**（一个模拟老插件），**保持不变** —— 它正好充当「deprecated 别名仍可用」的回归测试。
   - `tests/unit/plugins/plugin-compatibility.test.ts`（导入并断言这些常量，`:4-6/:116-122`）：保留现有 `WEACPX_*` 断言（验证别名），并新增对 `XACPX_*` 规范名的等值断言。
   - 插件内部统一引用 `XacpxPlugin` 类型；`WeacpxPlugin` 作为 deprecated 别名**保留**（已存在，老插件 `.d.ts` 仍引用）。

6. **内部标识重命名**（确属内部、无公开 re-export）：
   - `WEACPX_KNOWN_COMMAND_PREFIXES`（`src/commands/command-list.ts:1`，未进 plugin-api）→ `XACPX_KNOWN_COMMAND_PREFIXES`。
   - `compatibility.ts` 的 `currentWeacpxVersion` 上下文字段与错误消息字段标签 → `*Xacpx*`（**注意：不改对 plugin 元数据 `minWeacpxVersion` 的读取**）。

7. **`weacpxCommand` 字段 / `buildWeacpxMcpServerSpec` / `resolveDefaultWeacpxCommand`**（`src/transport/acpx-queue-owner-launcher.ts:47/63/64/68/109/120/155/156/276`，仅被本文件与 `tests/unit/transport/acpx-queue-owner-launcher.test.ts` 引用）→ `xacpxCommand` / `buildXacpxMcpServerSpec` / `resolveDefaultXacpxCommand`（内部改名；解析出的命令值不变，本就指向 xacpx bin）。

8. **orchestration pipe 名** `weacpx-orchestration-` → `xacpx-orchestration-`（`src/orchestration/orchestration-ipc.ts:127`，server/client 共用同一路径 helper，一处改）。

### 留（KEEP，明确不动）

- 插件元数据**读取** `minWeacpxVersion` / `compatibleWeacpxVersions`（容忍）+ `WeacpxPlugin` 公开类型别名。
- env `WEACPX_*` 回退（`src/runtime/core-env.ts` 的 `coreEnv`）。
- `~/.weacpx` 旧目录回退 + `src/runtime/migrate-core-home.ts` + 其 "weacpx stop / xacpx stop" 提示文案。
- `src/cli-update.ts` 的 `SUCCESSOR.from = "weacpx"` + 迁移 UX 文案 + `explicitTarget === "weacpx"` 匹配（`cli-update.ts:211`）。
- `src/plugins/plugin-home.ts` 的 `weacpx` shim 变体（老插件 `import "weacpx/plugin-api"`）+ `plugin-renames.ts`。
- `CHANGELOG.md` 历史条目。
- `weacpx-compat/` 转发 shim 包。

## 数据流 / 行为影响

- MCP：daemon 重启后，下一次 prompt 的 queue owner 注入名为 `xacpx` 的 MCP server，agent 看到 `mcp__xacpx__*`。无持久化、无迁移。
- state：旧 `state.json` 若含 `source:"weacpx"` 仍被 `isSessionSource` 接受（不写新值，逻辑只看 `agent-side`），新写入永远是 `undefined` 或 `"agent-side"`。
- 插件：首方插件（已用 `*Xacpx*` 字段）不受影响；老/第三方插件的 `minWeacpxVersion` 仍被读取（容忍读取保留）。

## 错误处理 / 边界

- 文件重命名必须用 `git mv` 并更新**所有** import（含测试、含 `src/main.ts` 等装配点），`tsc --noEmit` 兜底找漏。
- `isSessionSource` 必须保持对 legacy `"weacpx"` 的接受，否则旧 state.json 加载被拒。
- 不得改动「留」清单中的任何标识。

## 测试

- `tests/unit/mcp/*`：MCP server 名 / 工具前缀断言更新为 `xacpx` / `mcp__xacpx__*`；文件重命名后 import 同步。
- `tests/unit/state/`（或现有 state-store 测试）：新增/更新一条 `isSessionSource` 用例，断言它**同时**接受 legacy `"weacpx"` 与新 `"xacpx"`。
- `tests/unit/weixin/`：若有断言默认 bot agent 名的用例，更新为 `"xacpx"`。
- `tests/unit/plugins/`：常量/类型改名后断言同步；保留对老字段 `minWeacpxVersion` 读取的现有用例不变（验证容忍读取仍工作）。
- 全量 `npx tsc --noEmit` + `npm test`（逐文件 runner）兜底。

## 非目标（YAGNI）

- 不删除任何向后兼容/迁移代码（env 回退、状态目录迁移、cli-update 重定向、插件 shim、老字段读取）。
- 不做 npm 包层面的任何改动（包名/发布/deprecate 已在 0.8.0 完成）。
- 不重写 CHANGELOG 历史。
- 不为 MCP 线名/source 枚举提供「双名注册」或「自动数据迁移」——仓库内无引用，重启即可。
