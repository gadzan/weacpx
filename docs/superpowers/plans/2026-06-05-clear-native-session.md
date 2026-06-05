# `/clear` 保持 agent-side native 会话 — 实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让 `/clear` 作用于一条 agent-side native 会话时，清空后仍停留在一条 agent-side native 会话（全新空 rollout），并尽力关闭清空前那条旧 native 会话（保留其历史）。

**Architecture:** `/clear`（`session.reset`）已经会新建一条空 transport 会话。该空会话本身由 agent 分配了原生 `agentSessionId`。我们给 transport 增加一个回读方法 `getAgentSessionId`，在 reset 处理器里读回这个新 id，并用 `attachNativeSession` 把别名重新标成 native；读不到时回退到现有的 `attachSession`（weacpx），保证 `/clear` 不失败。重绑成功后，对旧 native 会话做 best-effort `removeSession`（`acpx sessions close`，保留历史），并用「无其他别名共享该 transport」做守卫。

**Tech Stack:** TypeScript、Bun（测试 `bun test`，类型检查 `npx tsc --noEmit`）、acpx CLI/bridge 两套 transport 实现。

参考 spec：`docs/superpowers/specs/2026-06-05-clear-native-session-design.md`

---

## File Structure

- `src/transport/types.ts` —— `SessionTransport` 接口新增可选方法 `getAgentSessionId?`。
- `src/transport/acpx-cli/acpx-cli-transport.ts` —— 扩展私有 `readSessionRecord` 解析 `agentSessionId`，新增公开 `getAgentSessionId`。
- `src/bridge/bridge-runtime.ts` —— 扩展私有 `readSessionRecord`，新增 `getAgentSessionId`。
- `src/bridge/bridge-server.ts` —— 注册并分发 `getAgentSessionId` 方法。
- `src/transport/acpx-bridge/acpx-bridge-protocol.ts` —— `BridgeMethod` 联合类型加 `"getAgentSessionId"`。
- `src/transport/acpx-bridge/acpx-bridge-transport.ts` —— 新增 `getAgentSessionId` 走 bridge client。
- `src/commands/handlers/session-reset-handler.ts` —— 核心逻辑改动。
- 测试：`tests/unit/transport/acpx-cli/acpx-cli-transport.test.ts`、`tests/unit/bridge/bridge-runtime.test.ts`、`tests/unit/commands/handlers/session-reset-handler.test.ts`（新建）。

每个 task 自带测试与提交。先做 transport 能力（Task 1–4），再做处理器（Task 5）。

---

## Task 1: `SessionTransport` 接口新增 `getAgentSessionId?`

**Files:**
- Modify: `src/transport/types.ts:137-139`

- [ ] **Step 1: 在接口里加方法**

在 `SessionTransport` 接口中 `removeSession?` 那行下面新增（紧挨现有可选方法）：

```ts
  removeSession?(session: ResolvedSession): Promise<void>;
  /**
   * Read the underlying agent-native session id for an existing transport
   * session. Used by `/clear` to keep a native session native: the fresh
   * post-clear session is itself backed by a new agent rollout, and this
   * returns that rollout's resumable id. Returns undefined when the agent did
   * not advertise one. Optional: transports that can't resolve it omit it.
   */
  getAgentSessionId?(session: ResolvedSession): Promise<string | undefined>;
```

- [ ] **Step 2: 类型检查**

Run: `npx tsc --noEmit`
Expected: 通过（新增的是可选方法，不会破坏现有实现）。

- [ ] **Step 3: Commit**

```bash
git add src/transport/types.ts
git commit -m "feat(transport): add optional getAgentSessionId to SessionTransport"
```

---

## Task 2: acpx-cli 实现 `getAgentSessionId`

**Files:**
- Modify: `src/transport/acpx-cli/acpx-cli-transport.ts:392-419`（`readSessionRecord`）+ 新增 `getAgentSessionId`
- Test: `tests/unit/transport/acpx-cli/acpx-cli-transport.test.ts`

- [ ] **Step 1: 写失败测试**

在 `tests/unit/transport/acpx-cli/acpx-cli-transport.test.ts` 末尾追加：

```ts
test("getAgentSessionId returns the agentSessionId from sessions show", async () => {
  const run = mock(async () => ({
    code: 0,
    stdout: JSON.stringify({ acpxRecordId: "rec-1", agentSessionId: "agent-xyz" }),
    stderr: "",
  }));
  const runPty = mock(async () => ({ code: 0, stdout: "", stderr: "" }));
  const transport = new AcpxCliTransport({ command: "acpx" }, run, runPty);

  const id = await transport.getAgentSessionId(session);

  expect(id).toBe("agent-xyz");
  expect(run).toHaveBeenCalledWith("acpx", expect.arrayContaining(["sessions", "show", "backend:api-fix"]));
});

test("getAgentSessionId returns undefined when the record has no agentSessionId", async () => {
  const run = mock(async () => ({
    code: 0,
    stdout: JSON.stringify({ acpxRecordId: "rec-1" }),
    stderr: "",
  }));
  const runPty = mock(async () => ({ code: 0, stdout: "", stderr: "" }));
  const transport = new AcpxCliTransport({ command: "acpx" }, run, runPty);

  const id = await transport.getAgentSessionId(session);

  expect(id).toBeUndefined();
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `bun test tests/unit/transport/acpx-cli/acpx-cli-transport.test.ts`
Expected: FAIL（`transport.getAgentSessionId is not a function`）。

- [ ] **Step 3: 扩展 `readSessionRecord` 并新增 `getAgentSessionId`**

把 `readSessionRecord` 的签名与 JSON 解析改为同时返回 `agentSessionId`（替换 `src/transport/acpx-cli/acpx-cli-transport.ts:392-419` 整个方法体）：

```ts
  private async readSessionRecord(session: ResolvedSession): Promise<{ acpxRecordId: string; agentSessionId?: string }> {
    const result = await this.runCommand(this.command, this.buildArgs(session, [
      "sessions",
      "show",
      session.transportSession,
    ]));
    if (result.code !== 0) {
      const detail = normalizeCommandError(result) ?? `command failed with exit code ${result.code}`;
      throw new Error(detail);
    }
    try {
      const parsed = JSON.parse(result.stdout) as { acpxRecordId?: unknown; id?: unknown; agentSessionId?: unknown };
      const acpxRecordId = typeof parsed.acpxRecordId === "string"
        ? parsed.acpxRecordId
        : typeof parsed.id === "string"
          ? parsed.id
          : undefined;
      const agentSessionId = typeof parsed.agentSessionId === "string" ? parsed.agentSessionId : undefined;
      if (acpxRecordId) {
        return { acpxRecordId, agentSessionId };
      }
    } catch {
      const firstLine = result.stdout.trim().split(/\r?\n/, 1)[0];
      if (firstLine && /^[\w.:-]+$/.test(firstLine) && firstLine.length >= 8) {
        return { acpxRecordId: firstLine };
      }
    }
    throw new Error("failed to resolve acpx session record id");
  }

  async getAgentSessionId(session: ResolvedSession): Promise<string | undefined> {
    const record = await this.readSessionRecord(session);
    return record.agentSessionId;
  }
```

> 说明：`launchMcpQueueOwnerIfNeeded` 只读 `record.acpxRecordId`，新增字段对它无影响。

- [ ] **Step 4: 跑测试确认通过**

Run: `bun test tests/unit/transport/acpx-cli/acpx-cli-transport.test.ts`
Expected: PASS（含原有用例）。

- [ ] **Step 5: Commit**

```bash
git add src/transport/acpx-cli/acpx-cli-transport.ts tests/unit/transport/acpx-cli/acpx-cli-transport.test.ts
git commit -m "feat(acpx-cli): implement getAgentSessionId via sessions show"
```

---

## Task 3: bridge-runtime 实现 `getAgentSessionId`

**Files:**
- Modify: `src/bridge/bridge-runtime.ts:386-414`（`readSessionRecord`）+ 新增 `getAgentSessionId`
- Test: `tests/unit/bridge/bridge-runtime.test.ts`

- [ ] **Step 1: 写失败测试**

在 `tests/unit/bridge/bridge-runtime.test.ts` 末尾追加：

```ts
test("getAgentSessionId returns the agentSessionId from sessions show", async () => {
  const run = async () => ({
    code: 0,
    stdout: JSON.stringify({ acpxRecordId: "rec-1", agentSessionId: "agent-xyz" }),
    stderr: "",
  });
  const runtime = new BridgeRuntime("acpx", run);

  const result = await runtime.getAgentSessionId({
    agent: "codex",
    agentCommand: "codex",
    cwd: "/tmp/backend",
    name: "backend:review",
  });

  expect(result).toEqual({ agentSessionId: "agent-xyz" });
});

test("getAgentSessionId returns undefined agentSessionId when absent", async () => {
  const run = async () => ({
    code: 0,
    stdout: JSON.stringify({ acpxRecordId: "rec-1" }),
    stderr: "",
  });
  const runtime = new BridgeRuntime("acpx", run);

  const result = await runtime.getAgentSessionId({
    agent: "codex",
    cwd: "/tmp/backend",
    name: "backend:review",
  });

  expect(result).toEqual({ agentSessionId: undefined });
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `bun test tests/unit/bridge/bridge-runtime.test.ts`
Expected: FAIL（`runtime.getAgentSessionId is not a function`）。

- [ ] **Step 3: 扩展 `readSessionRecord` 并新增 `getAgentSessionId`**

把 `src/bridge/bridge-runtime.ts:386-414` 的 `readSessionRecord` 整体替换为：

```ts
  private async readSessionRecord(input: BridgeSessionInput): Promise<{ acpxRecordId: string; agentSessionId?: string }> {
    const spawnSpec = resolveSpawnCommand(this.command, this.buildSessionArgs(input, [
      "sessions",
      "show",
      input.name,
    ]));
    const result = await this.run(spawnSpec.command, spawnSpec.args);
    if (result.code !== 0) {
      throw new Error(result.stderr || result.stdout || "sessions show failed");
    }
    try {
      const parsed = JSON.parse(result.stdout) as { acpxRecordId?: unknown; id?: unknown; agentSessionId?: unknown };
      let acpxRecordId: string | undefined;
      if (typeof parsed.acpxRecordId === "string") {
        acpxRecordId = parsed.acpxRecordId;
      } else if (typeof parsed.id === "string") {
        acpxRecordId = parsed.id;
      }
      const agentSessionId = typeof parsed.agentSessionId === "string" ? parsed.agentSessionId : undefined;
      if (acpxRecordId) {
        return { acpxRecordId, agentSessionId };
      }
    } catch {
      const firstLine = result.stdout.trim().split(/\r?\n/, 1)[0];
      if (firstLine && /^[\w.:-]+$/.test(firstLine) && firstLine.length >= 8) {
        return { acpxRecordId: firstLine };
      }
    }
    throw new Error("failed to resolve acpx session record id");
  }

  async getAgentSessionId(input: {
    agent: string;
    agentCommand?: string;
    cwd: string;
    name: string;
  }): Promise<{ agentSessionId: string | undefined }> {
    const record = await this.readSessionRecord(input);
    return { agentSessionId: record.agentSessionId };
  }
```

> `getAgentSessionId` 的 `input` 形状与 `removeSession`（`src/bridge/bridge-runtime.ts:461-466`）一致，`buildSessionArgs` 能直接消费；`BridgeSessionInput` 是 `readSessionRecord` 现有的参数类型，兼容该 input。

- [ ] **Step 4: 跑测试确认通过**

Run: `bun test tests/unit/bridge/bridge-runtime.test.ts`
Expected: PASS。

- [ ] **Step 5: Commit**

```bash
git add src/bridge/bridge-runtime.ts tests/unit/bridge/bridge-runtime.test.ts
git commit -m "feat(bridge-runtime): implement getAgentSessionId via sessions show"
```

---

## Task 4: bridge 协议/分发/transport 接通 `getAgentSessionId`

**Files:**
- Modify: `src/transport/acpx-bridge/acpx-bridge-protocol.ts:3-15`
- Modify: `src/bridge/bridge-server.ts:23-47`（两个方法集合）+ `:234-240`（分发）
- Modify: `src/transport/acpx-bridge/acpx-bridge-transport.ts:191-193`（紧随 `removeSession`）
- Test: `tests/unit/bridge/bridge-server.test.ts`

- [ ] **Step 1: 写失败测试**

在 `tests/unit/bridge/bridge-server.test.ts` 末尾追加（若该文件已有 `BridgeServer`+假 `BridgeRuntime` 的构造方式，沿用之；下面用最小桩）：

```ts
test("dispatches getAgentSessionId to the runtime", async () => {
  const runtime = {
    getAgentSessionId: mock(async () => ({ agentSessionId: "agent-xyz" })),
  } as unknown as BridgeRuntime;
  const server = new BridgeServer(runtime);

  const line = await server.handleLine(
    JSON.stringify({
      id: "1",
      method: "getAgentSessionId",
      params: { agent: "codex", cwd: "/tmp/backend", name: "backend:review" },
    }),
  );

  expect(JSON.parse(line)).toEqual({ id: "1", ok: true, result: { agentSessionId: "agent-xyz" } });
  expect(runtime.getAgentSessionId).toHaveBeenCalledTimes(1);
});
```

> 顶部确保已 `import { mock } from "bun:test"` 和 `BridgeServer`、`BridgeRuntime`。

- [ ] **Step 2: 跑测试确认失败**

Run: `bun test tests/unit/bridge/bridge-server.test.ts`
Expected: FAIL（`unsupported bridge method: getAgentSessionId` 或校验拒绝该方法）。

- [ ] **Step 3: 协议类型加方法**

`src/transport/acpx-bridge/acpx-bridge-protocol.ts` 的 `BridgeMethod` 联合类型，在 `| "removeSession";` 前/后加一行：

```ts
  | "removeSession"
  | "getAgentSessionId";
```

- [ ] **Step 4: bridge-server 注册 + 分发**

在 `src/bridge/bridge-server.ts` 的 `BRIDGE_METHODS`（:23-36）集合里、`"removeSession",` 之后加 `"getAgentSessionId",`；在 `SESSION_SCOPED_METHODS`（:38-47）里同样在 `"removeSession",` 之后加 `"getAgentSessionId",`。

然后在 `dispatch` 的 `switch` 中，`case "removeSession":`（:234-240）之后、`default:` 之前加：

```ts
      case "getAgentSessionId":
        return await this.runtime.getAgentSessionId({
          agent: requireString(params, "agent"),
          agentCommand: asOptionalString(params.agentCommand),
          cwd: requireString(params, "cwd"),
          name: requireString(params, "name"),
        });
```

- [ ] **Step 5: acpx-bridge-transport 走 client**

在 `src/transport/acpx-bridge/acpx-bridge-transport.ts` 的 `removeSession`（:191-193）之后加：

```ts
  async getAgentSessionId(session: ResolvedSession): Promise<string | undefined> {
    const result = await this.client.request<{ agentSessionId?: string }>(
      "getAgentSessionId",
      this.toParams(session),
    );
    return result.agentSessionId;
  }
```

- [ ] **Step 6: 跑测试 + 类型检查**

Run: `bun test tests/unit/bridge/bridge-server.test.ts`
Expected: PASS。

Run: `npx tsc --noEmit`
Expected: 通过。

- [ ] **Step 7: Commit**

```bash
git add src/transport/acpx-bridge/acpx-bridge-protocol.ts src/bridge/bridge-server.ts src/transport/acpx-bridge/acpx-bridge-transport.ts tests/unit/bridge/bridge-server.test.ts
git commit -m "feat(bridge): wire getAgentSessionId through protocol, server, transport"
```

---

## Task 5: reset 处理器保持 native 并关闭旧会话

**Files:**
- Modify: `src/commands/handlers/session-reset-handler.ts:6-55`（替换 `handleSessionResetCommand` 整体）
- Test: `tests/unit/commands/handlers/session-reset-handler.test.ts`（新建）

- [ ] **Step 1: 写失败测试（新建文件）**

新建 `tests/unit/commands/handlers/session-reset-handler.test.ts`：

```ts
import { beforeEach, expect, mock, test } from "bun:test";
import { handleSessionResetCommand } from "../../../../src/commands/handlers/session-reset-handler";
import type { CommandRouterContext, SessionResetOps } from "../../../../src/commands/router-types";
import type { ResolvedSession } from "../../../../src/transport/types";
import { setLocale, t } from "../../../../src/i18n";

beforeEach(() => {
  setLocale("zh");
});

function resolved(overrides: Partial<ResolvedSession> = {}): ResolvedSession {
  return {
    alias: "review",
    agent: "codex",
    workspace: "backend",
    transportSession: "backend:review",
    agentCommand: "codex",
    cwd: "/tmp/backend",
    ...overrides,
  };
}

function build(opts: {
  current: ResolvedSession | null;
  agentSessionId?: string;
  getAgentSessionIdThrows?: boolean;
  removeSessionThrows?: boolean;
  sharingCount?: number;
}) {
  const attachNativeSession = mock(async (_input: unknown) => resolved());
  const attachSession = mock(async () => resolved());
  const useSession = mock(async () => {});
  const countAliasesSharingTransport = mock(() => opts.sharingCount ?? 0);
  const getAgentSessionId = mock(async (_s: ResolvedSession) => {
    if (opts.getAgentSessionIdThrows) throw new Error("show failed");
    return opts.agentSessionId;
  });
  const removeSession = mock(async (_s: ResolvedSession) => {
    if (opts.removeSessionThrows) throw new Error("close failed");
  });

  const context = {
    sessions: {
      getCurrentSession: mock(async () => opts.current),
      attachNativeSession,
      attachSession,
      useSession,
      countAliasesSharingTransport,
    },
    transport: { getAgentSessionId, removeSession },
    logger: { info: mock(async () => {}), error: mock(async () => {}) },
  } as unknown as CommandRouterContext;

  const ops: SessionResetOps = {
    resolveSession: (alias, agent, workspace, transportSession) =>
      resolved({ alias, agent, workspace, transportSession }),
    ensureTransportSession: mock(async () => {}),
    checkTransportSession: mock(async () => true),
    reserveTransportSession: mock(async () => async () => {}),
    refreshSessionTransportAgentCommand: mock(async () => {}),
    now: () => 1_700_000_000_000,
  };

  return { context, ops, attachNativeSession, attachSession, removeSession, getAgentSessionId, countAliasesSharingTransport };
}

test("native session stays native and closes the previous native session", async () => {
  const previous = resolved({ source: "agent-side", agentSessionId: "old-native", transportSession: "backend:review" });
  const ctx = build({ current: previous, agentSessionId: "fresh-native-id" });

  const reply = await handleSessionResetCommand(ctx.context, ctx.ops, "wx:user");

  expect(ctx.attachNativeSession).toHaveBeenCalledTimes(1);
  expect(ctx.attachNativeSession.mock.calls[0][0]).toMatchObject({ agentSessionId: "fresh-native-id" });
  expect(ctx.attachSession).not.toHaveBeenCalled();
  expect(ctx.removeSession).toHaveBeenCalledTimes(1);
  expect(ctx.removeSession.mock.calls[0][0]).toMatchObject({ transportSession: "backend:review" });
  expect(reply.text).toBe(t().misc.sessionResetSuccess("review"));
});

test("falls back to a weacpx session when the fresh agent id is unavailable", async () => {
  const previous = resolved({ source: "agent-side", agentSessionId: "old-native" });
  const ctx = build({ current: previous, agentSessionId: undefined });

  const reply = await handleSessionResetCommand(ctx.context, ctx.ops, "wx:user");

  expect(ctx.attachSession).toHaveBeenCalledTimes(1);
  expect(ctx.attachNativeSession).not.toHaveBeenCalled();
  expect(ctx.removeSession).toHaveBeenCalledTimes(1); // 旧 native 仍被关闭
  expect(reply.text).toBe(t().misc.sessionResetSuccess("review"));
});

test("falls back when reading the fresh agent id throws", async () => {
  const previous = resolved({ source: "agent-side", agentSessionId: "old-native" });
  const ctx = build({ current: previous, getAgentSessionIdThrows: true });

  const reply = await handleSessionResetCommand(ctx.context, ctx.ops, "wx:user");

  expect(ctx.attachSession).toHaveBeenCalledTimes(1);
  expect(ctx.attachNativeSession).not.toHaveBeenCalled();
  expect(reply.text).toBe(t().misc.sessionResetSuccess("review"));
});

test("a non-native session resets to weacpx and is left untouched", async () => {
  const previous = resolved({ source: "weacpx" });
  const ctx = build({ current: previous, agentSessionId: "fresh-native-id" });

  const reply = await handleSessionResetCommand(ctx.context, ctx.ops, "wx:user");

  expect(ctx.attachSession).toHaveBeenCalledTimes(1);
  expect(ctx.attachNativeSession).not.toHaveBeenCalled();
  expect(ctx.getAgentSessionId).not.toHaveBeenCalled();
  expect(ctx.removeSession).not.toHaveBeenCalled();
  expect(reply.text).toBe(t().misc.sessionResetSuccess("review"));
});

test("does not close the previous transport when another alias still shares it", async () => {
  const previous = resolved({ source: "agent-side", agentSessionId: "old-native" });
  const ctx = build({ current: previous, agentSessionId: "fresh-native-id", sharingCount: 1 });

  await handleSessionResetCommand(ctx.context, ctx.ops, "wx:user");

  expect(ctx.attachNativeSession).toHaveBeenCalledTimes(1);
  expect(ctx.removeSession).not.toHaveBeenCalled();
});

test("still succeeds when closing the previous session throws", async () => {
  const previous = resolved({ source: "agent-side", agentSessionId: "old-native" });
  const ctx = build({ current: previous, agentSessionId: "fresh-native-id", removeSessionThrows: true });

  const reply = await handleSessionResetCommand(ctx.context, ctx.ops, "wx:user");

  expect(reply.text).toBe(t().misc.sessionResetSuccess("review"));
});

test("returns the no-current-session message when there is no current session", async () => {
  const ctx = build({ current: null });

  const reply = await handleSessionResetCommand(ctx.context, ctx.ops, "wx:user");

  expect(reply.text).toBe(t().misc.sessionResetNoCurrentSession);
  expect(ctx.attachSession).not.toHaveBeenCalled();
  expect(ctx.attachNativeSession).not.toHaveBeenCalled();
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `bun test tests/unit/commands/handlers/session-reset-handler.test.ts`
Expected: FAIL（当前实现既不调用 `attachNativeSession`，也不在 reset 后 `removeSession`）。

- [ ] **Step 3: 替换 `handleSessionResetCommand`**

把 `src/commands/handlers/session-reset-handler.ts:6-55` 的整个函数替换为：

```ts
export async function handleSessionResetCommand(
  context: CommandRouterContext,
  ops: SessionResetOps,
  chatKey: string,
): Promise<RouterResponse> {
  const previous = await context.sessions.getCurrentSession(chatKey);
  if (!previous) {
    return { text: t().misc.sessionResetNoCurrentSession };
  }

  const wasNative = previous.source === "agent-side";

  const resetSession = ops.resolveSession(
    previous.alias,
    previous.agent,
    previous.workspace,
    buildResetTransportSessionName(previous, ops.now()),
  );

  const releaseTransportReservation = await ops.reserveTransportSession(resetSession.transportSession);
  try {
    try {
      await ops.ensureTransportSession(resetSession);
      const exists = await ops.checkTransportSession(resetSession);
      if (!exists) {
        return { text: t().misc.sessionResetFailed(previous.alias) };
      }
    } catch (error) {
      return renderTransportError(resetSession, error);
    }

    // Keep a native (agent-side) session native across /clear: the fresh
    // transport session is itself backed by a brand-new agent rollout, so read
    // back its agentSessionId and re-mark the logical session as native. If the
    // agent advertised none (or the read fails), fall back to a plain weacpx
    // session so /clear still succeeds.
    let freshAgentSessionId: string | undefined;
    if (wasNative) {
      try {
        freshAgentSessionId = await context.transport.getAgentSessionId?.(resetSession);
      } catch (error) {
        await context.logger.info(
          "session.reset.native_id_unavailable",
          "failed to read fresh agent session id; falling back to weacpx session",
          { alias: resetSession.alias, error: error instanceof Error ? error.message : String(error) },
        );
      }
    }

    if (wasNative && freshAgentSessionId) {
      await context.sessions.attachNativeSession({
        alias: resetSession.alias,
        agent: resetSession.agent,
        workspace: resetSession.workspace,
        transportSession: resetSession.transportSession,
        agentSessionId: freshAgentSessionId,
        updatedAt: new Date(ops.now()).toISOString(),
      });
    } else {
      await context.sessions.attachSession(
        resetSession.alias,
        resetSession.agent,
        resetSession.workspace,
        resetSession.transportSession,
      );
    }

    await ops.refreshSessionTransportAgentCommand(resetSession.alias);
    await context.sessions.useSession(chatKey, resetSession.alias);
    await context.logger.info("session.reset", "reset current logical session", {
      alias: resetSession.alias,
      agent: resetSession.agent,
      workspace: resetSession.workspace,
      transportSession: resetSession.transportSession,
      chatKey,
      native: wasNative && Boolean(freshAgentSessionId),
    });

    // Best-effort: close the previous native session (acpx sessions close) to
    // stop its warm owner while keeping its rollout on disk (still reattachable
    // via /ssn, prunable later). Guarded so we never close a transport another
    // logical alias still uses. Failure must never fail /clear.
    if (
      wasNative &&
      context.transport.removeSession &&
      context.sessions.countAliasesSharingTransport(previous.transportSession) === 0
    ) {
      try {
        await context.transport.removeSession(previous);
      } catch (error) {
        await context.logger.info(
          "session.reset.close_previous_failed",
          "failed to close previous native session after reset",
          {
            transportSession: previous.transportSession,
            error: error instanceof Error ? error.message : String(error),
          },
        );
      }
    }
  } finally {
    await releaseTransportReservation();
  }

  return { text: t().misc.sessionResetSuccess(resetSession.alias) };
}
```

> 不新增 import：`attachNativeSession` / `countAliasesSharingTransport` 在 `context.sessions` 上，`getAgentSessionId` / `removeSession` 在 `context.transport` 上，`logger` 在 `context` 上。`buildResetTransportSessionName`、`t`、`renderTransportError` 已在文件内。

- [ ] **Step 4: 跑测试确认通过**

Run: `bun test tests/unit/commands/handlers/session-reset-handler.test.ts`
Expected: PASS（7 个用例全绿）。

- [ ] **Step 5: 类型检查 + 回归相邻测试**

Run: `npx tsc --noEmit`
Expected: 通过。

Run: `bun test tests/unit/commands/command-router-session.test.ts`
Expected: PASS（确认 `/clear` 走 router 的既有用例未回归）。

- [ ] **Step 6: Commit**

```bash
git add src/commands/handlers/session-reset-handler.ts tests/unit/commands/handlers/session-reset-handler.test.ts
git commit -m "feat(commands): /clear keeps agent-side native sessions native and closes the old one"
```

---

## 收尾校验

- [ ] **全量类型检查**：`npx tsc --noEmit` 通过。
- [ ] **逐文件跑本次涉及测试**（按项目约定逐文件，勿整目录跑）：
  - `bun test tests/unit/transport/acpx-cli/acpx-cli-transport.test.ts`
  - `bun test tests/unit/bridge/bridge-runtime.test.ts`
  - `bun test tests/unit/bridge/bridge-server.test.ts`
  - `bun test tests/unit/commands/handlers/session-reset-handler.test.ts`
  - `bun test tests/unit/commands/command-router-session.test.ts`
- [ ] **构建**：`bun run build`（飞书/bridge 相关测试与运行依赖 dist，参见项目记忆）。

## Self-Review 备注（覆盖检查）

- spec「Transport 回读」→ Task 1–4；「Reset 处理器（核心）」→ Task 5；「关旧会话/仅关闭」→ Task 5 的 best-effort `removeSession`（守卫 + 静默失败）；「回退策略」→ Task 5 fallback 分支与两个 fallback 测试；「普通会话不变」→ Task 5 non-native 测试。
- 命名一致性：`getAgentSessionId`（transport 层返回 `string | undefined`；bridge-runtime 返回 `{ agentSessionId }`；bridge-transport 解包回 `string | undefined`）跨任务一致。
- 无占位符：每个改动步骤均给出完整代码与确切命令。
