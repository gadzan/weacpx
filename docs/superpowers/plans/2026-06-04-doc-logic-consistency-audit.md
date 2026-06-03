# 文档与代码逻辑一致性巡查 — 汇总与修复计划

> 巡查日期：2026-06-04。方法：按文档分域派遣只读审计子代理（config-reference / commands / README / daemon+commands module / external-mcp / code-wiki+testing），逐条与源码核对，再由主控逐项人工复核 `file:line`。

**结论**：`daemon-module.md`、`commands-module.md` 零偏差。其余文档存在 9 处真实漂移，已逐条复核确认（见下）。其中 8 处是“文档落后于代码”，安全直接改文档；1 处（`channel.replyMode` 默认值）是**代码内部不一致**，需产品决策。

---

## A. 安全修复（文档对齐代码，已核对）

| # | 严重度 | 位置 | 文档现状 | 代码事实 | 修复 |
|---|--------|------|----------|----------|------|
| A1 | high | `docs/config-reference.md:84` | `transport.type` Required = **Yes** | 可选；缺省 `"acpx-bridge"`（`src/config/load-config.ts:287-289`，校验仅在出现时 `load-config.ts:143`） | Required 改 No，补默认值说明 |
| A2 | high | `docs/config-reference.md:94` | 标题 `#### "acpx-cli" (default)` | 默认是 `"acpx-bridge"`（`load-config.ts:289`，且本文件 :573 自述 acpx-bridge） | 去掉 acpx-cli 的 “(default)”，标到 acpx-bridge |
| A3 | medium | `docs/config-reference.md` orchestration 表（:511-517） | 无 `progressHeartbeatSeconds` 行 | 存在，默认 `300`（`load-config.ts:53`、`types.ts:68`） | 补一行 |
| A4 | medium | `docs/config-command.md` Fixed fields（:46-56） | 缺 `transport.permissionPolicy` | 在白名单（`config-handler.ts:21`） | 补一行 |
| A5 | medium | `docs/commands.md` 支持路径（:252-272） | 缺 `language` | 在白名单（`config-handler.ts:15`） | 补一行 |
| A6 | low | `docs/commands.md:267` | `channel.type` 列在“当前支持路径” | 代码对该 key 直接报错/禁用（`config-handler.ts:164`）；config-command.md 已正确归入“向后兼容” | 从支持列表移除/标注禁用 |
| A7 | low | `docs/external-mcp.md:415` | 用 `WEACPX_MCP_PARENT_CHECK_INTERVAL_MS` | 读取优先 `XACPX_*`，`WEACPX_*` 仅遗留回退（`src/runtime/core-env.ts:16-23`） | 改首选 `XACPX_`，注明遗留仍兼容 |
| A8 | high | `docs/code-wiki.md:132` | 链接 `../src/mcp/xacpx-mcp-server.ts` | 实际文件名 `weacpx-mcp-server.ts`（链接 404） | 修正文件名 |
| A9 | low | `README.md:284` | “running `weacpx update` will offer to migrate…” | 当前包已是 `@ganglion/xacpx`；该句站在旧 weacpx 视角，对 xacpx 读者过期 | 重述为“旧 weacpx 用户 `weacpx update` 会迁移到 xacpx” |

附带（low，可选，本轮顺手）：`README.md:7` zread 徽章指向 `zread.ai/gadzan/weacpx` → `xacpx`。

> 说明：`code-wiki.md` 还存在大量 `#Lxxx` 行号漂移（buildApp/main/CommandRouter/SessionService 等）。行号锚点天然易腐，本轮只修“断链文件名”（A8），其余行号不逐条追（属维护噪音，另议是否改用符号锚点）。

## B. 需决策（代码内部不一致，勿擅改）

| # | 位置 | 冲突 |
|---|------|------|
| B1 | `src/config/ensure-config.ts:34` vs `src/config/load-config.ts:46` / `docs/config-reference.md:210` | 新建配置模板写入 `replyMode: "stream"`，但“字段缺省时”的回退默认与文档都是 `"verbose"`。即**新用户实得 stream，文档却说默认 verbose**。需定：以哪个为准（改模板→verbose，或改文档说明“新配置初始化为 stream，缺省回退为 verbose”）。 |

---

## 执行

- A1–A9：纯文档编辑，安全直接做。
- B1：先问用户取向，再决定改代码模板还是改文档措辞。
- 不触碰工作区既有无关改动（`src/cli-update.ts`、`tests/unit/cli-update.test.ts`）。
