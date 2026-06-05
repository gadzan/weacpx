# Per-Channel replyMode Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let each channel carry its own default reply mode via `channels[].replyMode`, resolved between the per-session override and the global `channel.replyMode` default, with two write surfaces (`/config set` and the `xacpx channel` CLI), fully backward-compatible.

**Architecture:** Add an optional `replyMode` field to `ChannelRuntimeConfig`. Introduce a single pure resolution helper implementing the precedence chain `session override → channel default → global default → "verbose"`. Wire that helper into the one behavioral resolution site (`promptWithSession`) and the two `/replymode` display sites — downstream transports already read the resolved `session.replyMode`, so no transport changes are needed. Add two write surfaces and docs.

**Tech Stack:** TypeScript, Bun test runner, project i18n (`src/i18n/messages/{zh,en}/*`).

**Backward compatibility contract:** `replyMode?` is optional. Configs without it parse to `undefined` and fall through to the existing global default — behavior is byte-for-byte identical to today. The legacy `wechat.replyMode → channel.replyMode` mapping is untouched. `/replymode` (session override) remains the highest precedence.

**Precedence (final):**
```
session.replyMode  →  channels[id].replyMode  →  channel.replyMode  →  "verbose"
```

---

## File Structure

- `src/config/types.ts` — add `replyMode?: ReplyMode` to `ChannelRuntimeConfig` (Task 1)
- `src/config/load-config.ts` — present-only validation + pass-through in `parseRuntimeChannelConfig` (Task 1)
- `src/commands/handlers/resolve-reply-mode.ts` — **new** pure resolution helpers (Task 2)
- `src/commands/handlers/session-handler.ts` — wire helper into prompt + `/replymode` show/reset (Task 3)
- `src/i18n/{types,messages/zh/session,messages/en/session}.ts` — `replyModeChannelDefault` label (Task 3)
- `src/commands/handlers/config-handler.ts` — `channels.<id>.replyMode` dynamic write path (Task 4)
- `src/i18n/{types,messages/zh/config,messages/en/config}.ts` — config channel-not-found + invalid messages (Task 4)
- `src/channels/cli/channel-cli.ts` — `set-reply-mode <id> <mode>` subcommand (Task 5)
- `src/i18n/{types,messages/zh/channel-cli,messages/en/channel-cli}.ts` — CLI strings (Task 5)
- `docs/config-reference.md`, `docs/config-command.md`, `docs/channel-management.md` — docs (Task 6)

---

## Task 1: Add `replyMode` to `ChannelRuntimeConfig` + load-config parsing

**Files:**
- Modify: `src/config/types.ts:78-83`
- Modify: `src/config/load-config.ts:414-438`
- Test: `tests/unit/config/load-config.test.ts`

- [ ] **Step 1: Write the failing tests**

Append to `tests/unit/config/load-config.test.ts` (the file already imports `loadConfig`, `mkdtemp`, `writeFile`, `rm`, `join`, `tmpdir`):

```ts
test("loads an explicit per-channel replyMode in channels[]", async () => {
  const dir = await mkdtemp(join(tmpdir(), "weacpx-config-"));
  const path = join(dir, "config.json");

  await writeFile(
    path,
    JSON.stringify({
      transport: { type: "acpx-bridge" },
      channel: { type: "weixin", replyMode: "verbose" },
      channels: [
        { id: "weixin", type: "weixin", enabled: true, replyMode: "final" },
        { id: "feishu", type: "feishu", enabled: true },
      ],
      agents: { codex: { driver: "codex" } },
      workspaces: {},
    }),
  );

  const config = await loadConfig(path);
  expect(config.channels.find((c) => c.id === "weixin")?.replyMode).toBe("final");
  expect(config.channels.find((c) => c.id === "feishu")?.replyMode).toBeUndefined();

  await rm(dir, { recursive: true, force: true });
});

test("omitting channels[].replyMode leaves it undefined (backward compatible)", async () => {
  const dir = await mkdtemp(join(tmpdir(), "weacpx-config-"));
  const path = join(dir, "config.json");

  await writeFile(
    path,
    JSON.stringify({
      transport: { type: "acpx-bridge" },
      channels: [{ id: "weixin", type: "weixin", enabled: true }],
      agents: { codex: { driver: "codex" } },
      workspaces: {},
    }),
  );

  const config = await loadConfig(path);
  expect(config.channels[0]?.replyMode).toBeUndefined();

  await rm(dir, { recursive: true, force: true });
});

test("throws when channels[].replyMode is invalid", async () => {
  const dir = await mkdtemp(join(tmpdir(), "weacpx-config-"));
  const path = join(dir, "config.json");

  await writeFile(
    path,
    JSON.stringify({
      transport: { type: "acpx-bridge" },
      channels: [{ id: "weixin", type: "weixin", enabled: true, replyMode: "loud" }],
      agents: { codex: { driver: "codex" } },
      workspaces: {},
    }),
  );

  await expect(loadConfig(path)).rejects.toThrow(
    "channels[0].replyMode must be stream, final, or verbose",
  );

  await rm(dir, { recursive: true, force: true });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `bun test tests/unit/config/load-config.test.ts`
Expected: FAIL — the explicit-replyMode test sees `undefined` (field dropped), and the invalid test does not throw.

- [ ] **Step 3: Add the type field**

In `src/config/types.ts`, change `ChannelRuntimeConfig` (currently lines 78-83):

```ts
export interface ChannelRuntimeConfig {
  id: string;
  type: string;
  enabled: boolean;
  replyMode?: ReplyMode;
  options?: Record<string, unknown>;
}
```

(`ReplyMode` is already declared at the top of this file — line 5.)

- [ ] **Step 4: Parse + validate in load-config**

In `src/config/load-config.ts`, edit `parseRuntimeChannelConfig` (lines 414-438). After the `enabled` line and before the `options` block, add the present-only validation; then include `replyMode` in the returned object:

```ts
  const enabled = raw.enabled !== false;
  if ("replyMode" in raw && raw.replyMode !== undefined && !isReplyMode(raw.replyMode)) {
    throw new Error(`channels[${index}].replyMode must be stream, final, or verbose`);
  }
  let options: Record<string, unknown> | undefined = undefined;
  if ("feishu" in raw && isRecord(raw.feishu)) {
    options = raw.feishu;
  } else if ("options" in raw && isRecord(raw.options)) {
    options = raw.options;
  }
  return {
    id,
    type: raw.type,
    enabled,
    ...(isReplyMode(raw.replyMode) ? { replyMode: raw.replyMode } : {}),
    ...(options ? { options } : {}),
  };
```

(`isReplyMode` is defined at module scope, line 67.)

- [ ] **Step 5: Run tests to verify they pass**

Run: `bun test tests/unit/config/load-config.test.ts`
Expected: PASS (all tests, including the three new ones).

- [ ] **Step 6: Typecheck**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 7: Commit**

```bash
git add src/config/types.ts src/config/load-config.ts tests/unit/config/load-config.test.ts
git commit -m "feat(config): add optional per-channel replyMode to channels[]"
```

---

## Task 2: Pure reply-mode resolution helper

**Files:**
- Create: `src/commands/handlers/resolve-reply-mode.ts`
- Test: `tests/unit/commands/handlers/resolve-reply-mode.test.ts`

- [ ] **Step 1: Write the failing test**

Create `tests/unit/commands/handlers/resolve-reply-mode.test.ts`:

```ts
import { expect, test } from "bun:test";
import {
  resolveChannelDefaultReplyMode,
  resolveEffectiveReplyMode,
} from "../../../../src/commands/handlers/resolve-reply-mode";
import { registerKnownChannelId } from "../../../../src/channels/channel-scope";
import type { AppConfig } from "../../../../src/config/types";

// feishu must be a known channel id for getChannelIdFromChatKey to map a
// feishu:* chatKey to "feishu"; weixin is always known.
registerKnownChannelId("feishu");

function makeConfig(over: Partial<AppConfig> = {}): AppConfig {
  return {
    channel: { type: "weixin", replyMode: "verbose" },
    channels: [
      { id: "weixin", type: "weixin", enabled: true },
      { id: "feishu", type: "feishu", enabled: true, replyMode: "final" },
    ],
    ...over,
  } as AppConfig;
}

test("resolveChannelDefaultReplyMode returns the channel's replyMode", () => {
  expect(resolveChannelDefaultReplyMode(makeConfig(), "feishu:acct:chat")).toBe("final");
});

test("resolveChannelDefaultReplyMode returns undefined when channel has no replyMode", () => {
  expect(resolveChannelDefaultReplyMode(makeConfig(), "weixin:u")).toBeUndefined();
});

test("resolveChannelDefaultReplyMode returns undefined for missing config", () => {
  expect(resolveChannelDefaultReplyMode(undefined, "feishu:acct:chat")).toBeUndefined();
});

test("effective: session override wins over everything", () => {
  expect(resolveEffectiveReplyMode(makeConfig(), "feishu:acct:chat", "stream")).toBe("stream");
});

test("effective: channel default wins over global default", () => {
  expect(resolveEffectiveReplyMode(makeConfig(), "feishu:acct:chat", undefined)).toBe("final");
});

test("effective: falls back to global default when channel has none", () => {
  expect(resolveEffectiveReplyMode(makeConfig(), "weixin:u", undefined)).toBe("verbose");
});

test("effective: falls back to verbose when config is missing", () => {
  expect(resolveEffectiveReplyMode(undefined, "weixin:u", undefined)).toBe("verbose");
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `bun test tests/unit/commands/handlers/resolve-reply-mode.test.ts`
Expected: FAIL with module-not-found for `resolve-reply-mode`.

- [ ] **Step 3: Implement the helper**

Create `src/commands/handlers/resolve-reply-mode.ts`:

```ts
import { getChannelIdFromChatKey } from "../../channels/channel-scope";
import type { AppConfig, ReplyMode } from "../../config/types";

/**
 * The per-channel default reply mode declared on `channels[].replyMode`, or
 * `undefined` when the channel does not set one (so callers fall through to the
 * global default). The channel is derived from the chatKey the same way the rest
 * of the system scopes sessions.
 */
export function resolveChannelDefaultReplyMode(
  config: AppConfig | undefined,
  chatKey: string,
): ReplyMode | undefined {
  if (!config) return undefined;
  const channelId = getChannelIdFromChatKey(chatKey);
  return config.channels.find((channel) => channel.id === channelId)?.replyMode;
}

/**
 * Effective reply mode precedence:
 *   session override → per-channel default → global channel.replyMode → "verbose".
 */
export function resolveEffectiveReplyMode(
  config: AppConfig | undefined,
  chatKey: string,
  sessionOverride: ReplyMode | undefined,
): ReplyMode {
  return (
    sessionOverride ??
    resolveChannelDefaultReplyMode(config, chatKey) ??
    config?.channel.replyMode ??
    "verbose"
  );
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `bun test tests/unit/commands/handlers/resolve-reply-mode.test.ts`
Expected: PASS (7 tests).

- [ ] **Step 5: Commit**

```bash
git add src/commands/handlers/resolve-reply-mode.ts tests/unit/commands/handlers/resolve-reply-mode.test.ts
git commit -m "feat(sessions): add per-channel reply-mode resolution helper"
```

---

## Task 3: Wire the helper into session-handler (behavior + `/replymode` display)

**Files:**
- Modify: `src/commands/handlers/session-handler.ts:384-404` (show), `:420-429` (reset), `:624` (prompt)
- Modify: `src/i18n/types.ts` (add `replyModeChannelDefault`)
- Modify: `src/i18n/messages/zh/session.ts`, `src/i18n/messages/en/session.ts`
- Test: `tests/unit/commands/handlers/session-handler.test.ts`

- [ ] **Step 1: Add the i18n label key (types + zh + en)**

In `src/i18n/types.ts`, after `replyModeGlobalDefault` (line 43) add:

```ts
  replyModeChannelDefault: (value: string) => string;
```

In `src/i18n/messages/zh/session.ts`, after the `replyModeGlobalDefault` line (line 48) add:

```ts
  replyModeChannelDefault: (value) => `- 频道默认：${value}`,
```

In `src/i18n/messages/en/session.ts`, after the `replyModeGlobalDefault` line (line 51) add:

```ts
  replyModeChannelDefault: (value) => `- Channel default: ${value}`,
```

- [ ] **Step 2: Write the failing test**

Append to `tests/unit/commands/handlers/session-handler.test.ts` (imports `handleReplyModeShow` must be added to the existing import on line 2):

```ts
test("handleReplyModeShow reports the per-channel default and resolves effective from it", async () => {
  const session = { alias: "weixin:backend", replyMode: undefined } as any;
  const context = {
    sessions: { getCurrentSession: async (_k: string) => session },
    config: {
      channel: { type: "weixin", replyMode: "verbose" },
      channels: [{ id: "weixin", type: "weixin", enabled: true, replyMode: "final" }],
    },
  } as any;

  const result = await handleReplyModeShow(context, "weixin:u");
  const s = t().session;
  expect(result.text).toContain(s.replyModeChannelDefault("final"));
  expect(result.text).toContain(s.replyModeEffective("final"));
  expect(result.text).toContain(s.replyModeGlobalDefault("verbose"));
});

test("handleReplyModeShow shows session override as effective over channel default", async () => {
  const session = { alias: "weixin:backend", replyMode: "stream" } as any;
  const context = {
    sessions: { getCurrentSession: async (_k: string) => session },
    config: {
      channel: { type: "weixin", replyMode: "verbose" },
      channels: [{ id: "weixin", type: "weixin", enabled: true, replyMode: "final" }],
    },
  } as any;

  const result = await handleReplyModeShow(context, "weixin:u");
  const s = t().session;
  expect(result.text).toContain(s.replyModeEffective("stream"));
});
```

Update the import line 2 to include `handleReplyModeShow`:

```ts
import { handleCancel, handlePrompt, handleReplyModeShow, handleSessionUse, handleSessions } from "../../../../src/commands/handlers/session-handler";
```

- [ ] **Step 3: Run the test to verify it fails**

Run: `bun test tests/unit/commands/handlers/session-handler.test.ts`
Expected: FAIL — show output lacks the channel-default line and effective is `verbose`, not `final`.

- [ ] **Step 4: Import the helper in session-handler**

In `src/commands/handlers/session-handler.ts`, add to the imports near the top (next to the existing `getChannelIdFromChatKey` import on line 15):

```ts
import { resolveChannelDefaultReplyMode, resolveEffectiveReplyMode } from "./resolve-reply-mode";
```

- [ ] **Step 5: Update `handleReplyModeShow`**

Replace the body of `handleReplyModeShow` (lines 390-403) so it computes and displays the channel default and resolves effective through the helper:

```ts
  const globalDefault = context.config?.channel.replyMode ?? "verbose";
  const channelDefault = resolveChannelDefaultReplyMode(context.config, chatKey);
  const sessionOverride = session.replyMode;
  const effective = resolveEffectiveReplyMode(context.config, chatKey, sessionOverride);
  const s = t().session;

  return {
    text: [
      s.replyModeHeader,
      s.replyModeSessionLabel(toDisplaySessionAlias(session.alias)),
      s.replyModeGlobalDefault(globalDefault),
      s.replyModeChannelDefault(channelDefault ?? s.modeNotSet),
      s.replyModeSessionOverride(sessionOverride ?? s.modeNotSet),
      s.replyModeEffective(effective),
    ].join("\n"),
  };
```

- [ ] **Step 6: Update `handleReplyModeReset` to report the real fallback**

Replace the tail of `handleReplyModeReset` (lines 426-428) so the reported fallback reflects the channel default when present:

```ts
  await context.sessions.setCurrentSessionReplyMode(chatKey, undefined);
  const fallback = resolveEffectiveReplyMode(context.config, chatKey, undefined);
  return { text: t().session.replyModeReset(fallback) };
```

- [ ] **Step 7: Update the behavioral resolution in `promptWithSession`**

Replace line 624:

```ts
const effectiveReplyMode = session.replyMode ?? context.config?.channel.replyMode ?? "verbose";
```

with:

```ts
  const effectiveReplyMode = resolveEffectiveReplyMode(context.config, chatKey, session.replyMode);
```

(Leave the following `if (!session.replyMode) session.replyMode = effectiveReplyMode;` line as-is — it still folds the resolved value into the in-memory session so transports format correctly.)

- [ ] **Step 8: Run the test to verify it passes**

Run: `bun test tests/unit/commands/handlers/session-handler.test.ts`
Expected: PASS (existing tests plus the two new ones).

- [ ] **Step 9: Typecheck**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 10: Commit**

```bash
git add src/commands/handlers/session-handler.ts src/i18n/types.ts src/i18n/messages/zh/session.ts src/i18n/messages/en/session.ts tests/unit/commands/handlers/session-handler.test.ts
git commit -m "feat(sessions): resolve replyMode through per-channel default + show it in /replymode"
```

---

## Task 4: `/config set channels.<id>.replyMode` write surface

**Files:**
- Modify: `src/commands/handlers/config-handler.ts:16-31` (supported-paths list), `:223-224` (dynamic match)
- Modify: `src/i18n/types.ts`, `src/i18n/messages/zh/config.ts`, `src/i18n/messages/en/config.ts`
- Test: `tests/unit/commands/handlers/config-handler.test.ts` (create if absent)

- [ ] **Step 1: Add i18n keys (types + zh + en)**

In `src/i18n/types.ts`, in the config-messages interface near `channelReplyModeInvalid` (line 724) add:

```ts
  channelRuntimeNotFound: (id: string) => string;
  channelRuntimeReplyModeInvalid: (id: string) => string;
```

In `src/i18n/messages/zh/config.ts`, after `channelReplyModeInvalid` (line 56) add:

```ts
  channelRuntimeNotFound: (id) => `频道「${id}」不存在；请先用 \`xacpx channel add ${id}\` 添加。`,
  channelRuntimeReplyModeInvalid: (id) => `channels.${id}.replyMode 只支持：stream、final、verbose`,
```

In `src/i18n/messages/en/config.ts`, at the matching location add:

```ts
  channelRuntimeNotFound: (id) => `Channel "${id}" does not exist; add it first with \`xacpx channel add ${id}\`.`,
  channelRuntimeReplyModeInvalid: (id) => `channels.${id}.replyMode only supports: stream, final, verbose`,
```

- [ ] **Step 2: Write the failing test**

Create `tests/unit/commands/handlers/config-handler.test.ts`:

```ts
import { expect, test, beforeEach } from "bun:test";
import { handleConfigSet } from "../../../../src/commands/handlers/config-handler";
import { setLocale } from "../../../../src/i18n";

beforeEach(() => setLocale("zh"));

function makeContext() {
  const saved: any[] = [];
  const config = {
    channel: { type: "weixin", replyMode: "verbose" },
    channels: [
      { id: "weixin", type: "weixin", enabled: true },
      { id: "feishu", type: "feishu", enabled: true },
    ],
  } as any;
  return {
    saved,
    context: {
      config,
      configStore: { save: async (c: any) => { saved.push(c); } },
      transport: {},
      replaceConfig: (c: any) => { (makeContext as any)._last = c; },
    } as any,
  };
}

test("/config set channels.feishu.replyMode final writes the per-channel default", async () => {
  const { context, saved } = makeContext();
  const result = await handleConfigSet(context, "channels.feishu.replyMode", "final");
  expect(result.text).not.toContain("不支持");
  expect(saved[0].channels.find((c: any) => c.id === "feishu").replyMode).toBe("final");
  expect(saved[0].channels.find((c: any) => c.id === "weixin").replyMode).toBeUndefined();
});

test("/config set rejects an invalid replyMode value", async () => {
  const { context, saved } = makeContext();
  const result = await handleConfigSet(context, "channels.feishu.replyMode", "loud");
  expect(result.text).toContain("stream");
  expect(saved.length).toBe(0);
});

test("/config set rejects an unknown channel id", async () => {
  const { context, saved } = makeContext();
  const result = await handleConfigSet(context, "channels.nope.replyMode", "final");
  expect(result.text).toContain("nope");
  expect(saved.length).toBe(0);
});
```

- [ ] **Step 3: Run the test to verify it fails**

Run: `bun test tests/unit/commands/handlers/config-handler.test.ts`
Expected: FAIL — `channels.feishu.replyMode` is not a supported path yet (`pathNotSupported`).

- [ ] **Step 4: Add the path to the supported-paths display list**

In `src/commands/handlers/config-handler.ts`, in `SUPPORTED_CONFIG_PATHS` (lines 16-31), add after `"channel.replyMode"` (line 26):

```ts
  "channels.<id>.replyMode",
```

- [ ] **Step 5: Add the dynamic write match**

In `applySupportedConfigUpdate`, immediately before the final `return { error: c.pathNotSupported(path) };` (line 224), add:

```ts
  const channelMatch = path.match(/^channels\.([^.]+)\.replyMode$/);
  if (channelMatch) {
    const [, id] = channelMatch;
    if (!id) {
      return { error: c.pathNotSupported(path) };
    }
    const channel = config.channels.find((entry) => entry.id === id);
    if (!channel) {
      return { error: c.channelRuntimeNotFound(id) };
    }
    const parsed = parseEnum<ReplyMode>(rawValue, ["stream", "final", "verbose"]);
    if (!parsed) {
      return { error: c.channelRuntimeReplyModeInvalid(id) };
    }
    channel.replyMode = parsed;
    return { renderedValue: parsed };
  }

```

(`ReplyMode`, `parseEnum`, and `config.channels` are all already in scope in this file.)

- [ ] **Step 6: Run the test to verify it passes**

Run: `bun test tests/unit/commands/handlers/config-handler.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 7: Typecheck**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 8: Commit**

```bash
git add src/commands/handlers/config-handler.ts src/i18n/types.ts src/i18n/messages/zh/config.ts src/i18n/messages/en/config.ts tests/unit/commands/handlers/config-handler.test.ts
git commit -m "feat(config): support /config set channels.<id>.replyMode"
```

---

## Task 5: `xacpx channel set-reply-mode <id> <mode>` CLI surface

**Files:**
- Modify: `src/channels/cli/channel-cli.ts:23-47` (dispatch) + add `setChannelReplyMode`
- Modify: `src/i18n/types.ts`, `src/i18n/messages/zh/channel-cli.ts`, `src/i18n/messages/en/channel-cli.ts`
- Test: `tests/unit/channels/cli/channel-cli.test.ts` (create if absent)

- [ ] **Step 1: Add i18n keys (types + zh + en)**

In `src/i18n/types.ts`, in the `ChannelCliMessages` interface near `channelEnabledToggled` (line 981) add:

```ts
  channelReplyModeSet: (id: string, mode: string) => string;
  channelReplyModeInvalid: (mode: string) => string;
```

In `src/i18n/messages/zh/channel-cli.ts`, after `channelEnabledToggled` (line 27) add:

```ts
  channelReplyModeSet: (id, mode) => `频道 ${id} 的默认 reply mode 已设置为：${mode}`,
  channelReplyModeInvalid: (mode) => `reply mode 只支持 stream / final / verbose，收到：${mode}`,
```

In `src/i18n/messages/en/channel-cli.ts`, at the matching location add:

```ts
  channelReplyModeSet: (id, mode) => `Channel ${id} default reply mode set to: ${mode}`,
  channelReplyModeInvalid: (mode) => `reply mode must be stream / final / verbose, got: ${mode}`,
```

- [ ] **Step 2: Write the failing test**

Create `tests/unit/channels/cli/channel-cli.test.ts`:

```ts
import { expect, test, beforeEach } from "bun:test";
import { handleChannelCli } from "../../../../src/channels/cli/channel-cli";
import { setLocale } from "../../../../src/i18n";

beforeEach(() => setLocale("zh"));

function makeDeps(initialChannels: any[]) {
  const out: string[] = [];
  let stored = {
    channel: { type: "weixin", replyMode: "verbose" },
    channels: initialChannels,
  } as any;
  return {
    out,
    getStored: () => stored,
    deps: {
      print: (line: string) => out.push(line),
      isInteractive: () => false,
      promptText: async () => "",
      loadConfig: async () => JSON.parse(JSON.stringify(stored)),
      saveConfig: async (c: any) => { stored = c; },
      getDaemonStatus: async () => ({ state: "stopped" as const }),
      restartDaemon: async () => 0,
    } as any,
  };
}

test("set-reply-mode writes the channel's replyMode and reports saved", async () => {
  const { deps, getStored } = makeDeps([
    { id: "weixin", type: "weixin", enabled: true },
    { id: "feishu", type: "feishu", enabled: true },
  ]);
  const code = await handleChannelCli(["set-reply-mode", "feishu", "final"], deps);
  expect(code).toBe(0);
  expect(getStored().channels.find((c: any) => c.id === "feishu").replyMode).toBe("final");
});

test("set-reply-mode rejects an invalid mode", async () => {
  const { deps, out } = makeDeps([{ id: "weixin", type: "weixin", enabled: true }]);
  const code = await handleChannelCli(["set-reply-mode", "weixin", "loud"], deps);
  expect(code).toBe(1);
  expect(out.join("\n")).toContain("loud");
});

test("set-reply-mode rejects an unknown channel", async () => {
  const { deps, out } = makeDeps([{ id: "weixin", type: "weixin", enabled: true }]);
  const code = await handleChannelCli(["set-reply-mode", "nope", "final"], deps);
  expect(code).toBe(1);
  expect(out.join("\n")).toContain("nope");
});
```

- [ ] **Step 3: Run the test to verify it fails**

Run: `bun test tests/unit/channels/cli/channel-cli.test.ts`
Expected: FAIL — `set-reply-mode` falls into the `default` branch and returns `null`, so `code` is `null` not `0`.

- [ ] **Step 4: Add the dispatch case**

In `src/channels/cli/channel-cli.ts`, in the `switch (subcommand)` (lines 25-45), add before `default:`:

```ts
    case "set-reply-mode":
      if (args.length !== 3 || !args[1] || !args[2]) return null;
      return await setChannelReplyMode(args[1], args[2], deps);
```

- [ ] **Step 5: Implement `setChannelReplyMode`**

Add this function near `setChannelEnabled` (after line 369) in `src/channels/cli/channel-cli.ts`:

```ts
async function setChannelReplyMode(type: string, mode: string, deps: ChannelCliDeps): Promise<number> {
  if (mode !== "stream" && mode !== "final" && mode !== "verbose") {
    deps.print(t().channelCli.channelReplyModeInvalid(mode));
    return 1;
  }
  const config = await deps.loadConfig();
  ensureChannelsArray(config);
  const channel = findChannel(config.channels, type);
  if (!channel) {
    deps.print(t().channelCli.channelNotFound(type));
    return 1;
  }
  channel.replyMode = mode;
  await deps.saveConfig(config);
  deps.print(t().channelCli.channelReplyModeSet(channel.id, mode));
  return await maybeRestartAfterMutation("ask", deps);
}
```

(`ChannelRuntimeConfig.replyMode` is typed `ReplyMode`, and `"stream"|"final"|"verbose"` narrows to it after the guard. `maybeRestartAfterMutation` handles the restart-needed messaging — with a stopped daemon in the test it prints `savedDaemonStopped` and returns 0.)

- [ ] **Step 6: Run the test to verify it passes**

Run: `bun test tests/unit/channels/cli/channel-cli.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 7: Typecheck**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 8: Commit**

```bash
git add src/channels/cli/channel-cli.ts src/i18n/types.ts src/i18n/messages/zh/channel-cli.ts src/i18n/messages/en/channel-cli.ts tests/unit/channels/cli/channel-cli.test.ts
git commit -m "feat(channel-cli): add set-reply-mode <id> <mode> subcommand"
```

---

## Task 6: Documentation

**Files:**
- Modify: `docs/config-reference.md` (the `ChannelRuntimeConfig` table, line ~243-250; and the `channel.replyMode` notes, line ~206-220)
- Modify: `docs/config-command.md` (supported paths list + examples)
- Modify: `docs/channel-management.md` (line ~306, near the existing `channel.replyMode` note)

- [ ] **Step 1: Document the field in config-reference.md**

In `docs/config-reference.md`, add a row to the `ChannelRuntimeConfig` table (after the `enabled` row, ~line 249):

```markdown
| `replyMode` | `"stream"` \| `"final"` \| `"verbose"` | No | Per-channel default reply mode. When set, it overrides the global `channel.replyMode` for this channel; when omitted, the channel falls back to `channel.replyMode`. The per-session `/replymode` override still takes precedence over this. |
```

Then, in the `channel.replyMode` Notes list (~line 217), update the precedence note to:

```markdown
- This configuration is the **global default value**; a channel may override it via `channels[].replyMode`, and a session may override both via `/replymode`. Precedence: session override → `channels[].replyMode` → `channel.replyMode` → `verbose`.
```

- [ ] **Step 2: Document the write surfaces in config-command.md**

In `docs/config-command.md`, add to the supported-paths list (near `channel.replyMode`, ~line 56):

```markdown
- `channels.<id>.replyMode`（频道级默认；运行时热改，立即对该频道新回合生效）
```

And add an example (~line 33):

```markdown
/config set channels.feishu.replyMode final
```

- [ ] **Step 3: Document the channel CLI in channel-management.md**

In `docs/channel-management.md`, near the existing `channel.replyMode` note (~line 306), add:

```markdown
按频道设置默认回复模式：

    xacpx channel set-reply-mode feishu final
    xacpx restart

`channels[].replyMode` 覆盖全局 `channel.replyMode`，但仍低于会话级 `/replymode`。优先级：会话覆盖 → 频道默认 → 全局默认 → `verbose`。`/config set channels.<id>.replyMode` 是运行时热改路径；`xacpx channel set-reply-mode` 改盘后需 `xacpx restart` 生效。
```

- [ ] **Step 4: Commit**

```bash
git add docs/config-reference.md docs/config-command.md docs/channel-management.md
git commit -m "docs: document per-channel replyMode and its two write surfaces"
```

---

## Final Verification

- [ ] **Step 1: Full typecheck + unit suite**

Run: `npm test`
Expected: typecheck passes; unit tests pass. (Note: per the project's known state-leak caveat, if any failures look like cross-file state leakage, re-run the affected files individually — `bun test <file>` — to confirm they pass in isolation.)

- [ ] **Step 2: Build**

Run: `bun run build`
Expected: builds `dist/cli.js` and `dist/bridge/bridge-main.js` with no errors.

- [ ] **Step 3: Manual smoke (optional, no WeChat needed)**

Confirm the dynamic `/config set` path is wired by checking `/config` lists `channels.<id>.replyMode` among supported paths, and that `node ./dist/cli.js channel set-reply-mode weixin final` reports success against a local config.

---

## Self-Review Notes

- **Spec coverage:** type field (T1) ✓, load/validate present-only (T1) ✓, precedence chain in one helper (T2) ✓, behavioral wiring + display (T3) ✓, `/config set` write surface (T4) ✓, channel CLI write surface (T5) ✓, docs (T6) ✓, backward compat (T1 omitted-field test + T2 fallback tests) ✓.
- **Type consistency:** helper names `resolveChannelDefaultReplyMode` / `resolveEffectiveReplyMode` used identically in T2 (def), T3 (session-handler), and tests. i18n keys `replyModeChannelDefault`, `channelRuntimeNotFound`, `channelRuntimeReplyModeInvalid`, `channelReplyModeSet`, `channelReplyModeInvalid` are each added to `types.ts` + both locales.
- **Known caveat:** `getChannelIdFromChatKey` only maps non-weixin ids that were registered via `registerKnownChannelId`; the T2 test registers `feishu` explicitly. At runtime, channels register their ids on startup, so resolution works for live feishu/yuanbao chats.
```