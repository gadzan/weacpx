# Plugin Scheduled Messages 0.5 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Release `weacpx@0.5.0` with scheduled `/lt` delivery implemented for the Feishu and Yuanbao first-party channel plugins.

**Architecture:** Core owns the scheduled task lifecycle and passes a richer `ScheduledChannelMessageInput` to the channel registry. Feishu and Yuanbao each implement `sendScheduledMessage()` by sending a notice, running a non-interactive `agent.chat()` turn with `scheduledSessionAlias` metadata, and delivering text output back to the original chat using existing outbound channel primitives. Plugin package versions remain independent, but plugin metadata and peer dependencies require core `0.5.0`.

**Tech Stack:** TypeScript, Bun test runner, Bun build, npm package-lock metadata, first-party channel plugin packages.

---

## File Structure

- Modify `src/channels/types.ts`
  - Add optional `taskId?: string` to `ScheduledChannelMessageInput`.
- Modify `src/plugin-api.ts`
  - Export `ScheduledChannelMessageInput` for plugin implementers.
- Modify `src/main.ts`
  - Pass `taskId: task.id` into scheduled channel dispatch.
- Modify `package.json`, `package-lock.json`, `bun.lock`, `CHANGELOG.md`
  - Bump core to `0.5.0` and document the release.
- Modify `src/plugins/compatibility.ts`, `src/plugins/types.ts` if needed by current exports
  - Set first-party plugin minimum core constant to `0.5.0`.
- Modify `packages/channel-feishu/package.json`, `packages/channel-feishu/src/index.ts`
  - Keep plugin package version unchanged; require `weacpx >=0.5.0-0` / `minWeacpxVersion: "0.5.0"`.
- Modify `packages/channel-feishu/src/channel.ts`
  - Implement `sendScheduledMessage()`.
- Modify `packages/channel-yuanbao/package.json`, `packages/channel-yuanbao/src/index.ts`
  - Keep plugin package version unchanged; require `weacpx >=0.5.0-0` / `minWeacpxVersion: "0.5.0"`.
- Modify `packages/channel-yuanbao/src/channel.ts`
  - Implement `sendScheduledMessage()` and reply-token fallback for scheduled sends.
- Modify tests:
  - `tests/unit/plugins/plugin-api-types.test.ts`
  - `tests/unit/packages/package-metadata.test.ts`
  - `tests/unit/packages/channel-feishu/feishu-plugin.test.ts`
  - `tests/unit/packages/channel-yuanbao/yuanbao-plugin.test.ts`
  - `tests/unit/packages/channel-feishu/feishu-channel.test.ts`
  - `tests/unit/packages/channel-yuanbao/yuanbao-channel.test.ts`
  - selected plugin compatibility tests that assert the first-party minimum core constant.

---

### Task 1: Core scheduled API, version metadata, and compatibility declarations

**Files:**
- Modify: `src/channels/types.ts`
- Modify: `src/plugin-api.ts`
- Modify: `src/main.ts`
- Modify: `src/plugins/compatibility.ts`
- Modify: `package.json`
- Modify: `package-lock.json`
- Modify: `bun.lock`
- Modify: `CHANGELOG.md`
- Modify: `packages/channel-feishu/package.json`
- Modify: `packages/channel-yuanbao/package.json`
- Modify: `packages/channel-feishu/src/index.ts`
- Modify: `packages/channel-yuanbao/src/index.ts`
- Test: `tests/unit/plugins/plugin-api-types.test.ts`
- Test: `tests/unit/packages/package-metadata.test.ts`
- Test: `tests/unit/packages/channel-feishu/feishu-plugin.test.ts`
- Test: `tests/unit/packages/channel-yuanbao/yuanbao-plugin.test.ts`
- Test: `tests/unit/plugins/plugin-compatibility.test.ts`

- [ ] **Step 1: Write failing plugin API type export test**

In `tests/unit/plugins/plugin-api-types.test.ts`, update the type import block to include `ScheduledChannelMessageInput`:

```ts
import type {
  ChannelCliProvider,
  ChannelFactory,
  ChannelRuntimeConfig,
  MessageChannelRuntime,
  ScheduledChannelMessageInput,
  WeacpxPlugin,
} from "../../../src/plugin-api";
```

Inside `test("plugin-api exports the types needed by channel packages", ...)`, after `const config ...`, add:

```ts
  const scheduledInput: ScheduledChannelMessageInput = {
    chatKey: "demo:default:chat_1",
    sessionAlias: "demo-session",
    taskId: "k8f2",
    noticeText: "执行定时任务 #k8f2",
    promptText: "检查 CI",
  };
```

Add this assertion near the existing assertions:

```ts
  expect(scheduledInput.taskId).toBe("k8f2");
```

Add a source assertion:

```ts
  expect(source).toContain("ScheduledChannelMessageInput");
```

- [ ] **Step 2: Write failing metadata/version tests**

In `tests/unit/packages/package-metadata.test.ts`, update the version test to require `0.5.0` exactly:

```ts
test("root package version is 0.5.0", () => {
  const pkg = readJson("package.json");
  expect(pkg.version).toBe("0.5.0");
});
```

Replace the peer dependency assertion in `first-party channel plugins peer depend on weacpx`:

```ts
    expect(pkg.peerDependencies.weacpx).toBe(">=0.5.0-0");
```

In `tests/unit/packages/channel-feishu/feishu-plugin.test.ts`, change the metadata expectation:

```ts
  expect(plugin.minWeacpxVersion).toBe("0.5.0");
```

In `tests/unit/packages/channel-yuanbao/yuanbao-plugin.test.ts`, change the metadata expectation:

```ts
  expect(plugin.minWeacpxVersion).toBe("0.5.0");
```

In `tests/unit/plugins/plugin-compatibility.test.ts`, update only tests that assert the exported first-party minimum core constant. Keep generic semver tests for `0.4.0` if they test semver math. For the constant test, expect:

```ts
expect(WEACPX_PLUGIN_MIN_CORE_VERSION).toBe("0.5.0");
```

- [ ] **Step 3: Run failing tests**

Run:

```bash
bun test tests/unit/plugins/plugin-api-types.test.ts tests/unit/packages/package-metadata.test.ts tests/unit/packages/channel-feishu/feishu-plugin.test.ts tests/unit/packages/channel-yuanbao/yuanbao-plugin.test.ts tests/unit/plugins/plugin-compatibility.test.ts
```

Expected: FAIL because `ScheduledChannelMessageInput` is not exported from `src/plugin-api.ts`, versions still say `0.4.x`, plugin metadata still says `0.4.0`, and peer deps still say `>=0.4.0-0`.

- [ ] **Step 4: Export `ScheduledChannelMessageInput` and add `taskId` to core input**

In `src/channels/types.ts`, change `ScheduledChannelMessageInput` from:

```ts
export interface ScheduledChannelMessageInput {
  chatKey: string;
  sessionAlias: string;
  accountId?: string;
  replyContextToken?: string;
  noticeText: string;
  promptText: string;
  abortSignal?: AbortSignal;
}
```

To:

```ts
export interface ScheduledChannelMessageInput {
  chatKey: string;
  sessionAlias: string;
  /** Scheduled task id, used by channels for consistent user-facing failure notices. */
  taskId?: string;
  accountId?: string;
  replyContextToken?: string;
  noticeText: string;
  promptText: string;
  // Bounds the non-interactive agent turn so a wedged scheduled prompt cannot
  // hold the scheduler's tick lock forever; the scheduler aborts on timeout.
  abortSignal?: AbortSignal;
}
```

In `src/plugin-api.ts`, add `ScheduledChannelMessageInput` to the channel types export block:

```ts
export type {
  ChannelStartInput,
  ConsumerLock,
  ConsumerLockMetadata,
  ConsumerLockOptions,
  CoordinatorMessageInput,
  MessageChannelRuntime,
  OrchestrationDeliveryCallbacks,
  OutboundQuota,
  ScheduledChannelMessageInput,
  ToolUseEvent,
  ToolUseKind,
  ToolUseStatus,
} from "./channels/types.js";
```

In `src/main.ts`, add `taskId: task.id` to the scheduled dispatch input:

```ts
      await deps.channel.sendScheduledMessage({
        chatKey: task.chat_key,
        sessionAlias: task.session_alias,
        taskId: task.id,
        noticeText,
        promptText: task.message,
        abortSignal,
        ...(task.account_id ? { accountId: task.account_id } : {}),
        ...(task.reply_context_token ? { replyContextToken: task.reply_context_token } : {}),
      });
```

- [ ] **Step 5: Bump core and first-party compatibility metadata**

In root `package.json`, set:

```json
"version": "0.5.0"
```

In `src/plugins/compatibility.ts`, set:

```ts
export const WEACPX_PLUGIN_MIN_CORE_VERSION = "0.5.0" as const;
```

In `packages/channel-feishu/src/index.ts`, set:

```ts
minWeacpxVersion: "0.5.0",
```

In `packages/channel-yuanbao/src/index.ts`, set:

```ts
minWeacpxVersion: "0.5.0",
```

In `packages/channel-feishu/package.json`, keep `"version": "0.1.2"` unchanged and set:

```json
"peerDependencies": {
  "weacpx": ">=0.5.0-0"
}
```

In `packages/channel-yuanbao/package.json`, keep `"version": "0.1.1"` unchanged and set:

```json
"peerDependencies": {
  "weacpx": ">=0.5.0-0"
}
```

Update `package-lock.json` manually or by running `npm install --package-lock-only --ignore-scripts` so:

```json
{
  "version": "0.5.0",
  "packages": {
    "": { "version": "0.5.0" },
    "packages/channel-feishu": {
      "version": "0.1.2",
      "peerDependencies": { "weacpx": ">=0.5.0-0" }
    },
    "packages/channel-yuanbao": {
      "version": "0.1.1",
      "peerDependencies": { "weacpx": ">=0.5.0-0" }
    }
  }
}
```

Update `bun.lock` workspace peer dependency entries for both plugin workspaces to:

```json
"peerDependencies": {
  "weacpx": ">=0.5.0-0"
}
```

Do not change Feishu/Yuanbao plugin package versions in `package.json` files. If a lockfile already had stale plugin workspace versions, let the package manager update them to match the package manifests, but do not intentionally set either plugin to `0.5.0`.

- [ ] **Step 6: Add changelog entry**

At the top of `CHANGELOG.md`, above `## [0.4.10]`, add:

```md
## [0.5.0] - 2026-05-23

### Added

- **Feishu/Yuanbao 定时任务投递：** first-party Feishu 与 Yuanbao channel plugins 实现 `sendScheduledMessage`，`/lt` 到点后可向原飞书/元宝聊天发送触发通知、执行绑定会话 prompt，并把文本结果投递回原聊天。
- **插件 API 定时任务输入：** `weacpx/plugin-api` 导出 `ScheduledChannelMessageInput`，并在 scheduled dispatch 中携带 `taskId`，供插件生成一致的失败提示。

### Changed

- **插件最低 core 版本：** Feishu/Yuanbao 新版插件声明最低 `weacpx >=0.5.0`，插件包自身版本仍保持独立演进。
```

- [ ] **Step 7: Run tests and commit**

Run:

```bash
bun test tests/unit/plugins/plugin-api-types.test.ts tests/unit/packages/package-metadata.test.ts tests/unit/packages/channel-feishu/feishu-plugin.test.ts tests/unit/packages/channel-yuanbao/yuanbao-plugin.test.ts tests/unit/plugins/plugin-compatibility.test.ts
npx tsc --noEmit
```

Expected: PASS.

Commit:

```bash
git add src/channels/types.ts src/plugin-api.ts src/main.ts src/plugins/compatibility.ts package.json package-lock.json bun.lock CHANGELOG.md packages/channel-feishu/package.json packages/channel-yuanbao/package.json packages/channel-feishu/src/index.ts packages/channel-yuanbao/src/index.ts tests/unit/plugins/plugin-api-types.test.ts tests/unit/packages/package-metadata.test.ts tests/unit/packages/channel-feishu/feishu-plugin.test.ts tests/unit/packages/channel-yuanbao/yuanbao-plugin.test.ts tests/unit/plugins/plugin-compatibility.test.ts
git commit -m "chore: prepare scheduled plugin API for 0.5"
```

---

### Task 2: Implement Feishu scheduled message delivery

**Files:**
- Modify: `packages/channel-feishu/src/channel.ts`
- Test: `tests/unit/packages/channel-feishu/feishu-channel.test.ts`

- [ ] **Step 1: Write failing Feishu scheduled delivery test**

In `tests/unit/packages/channel-feishu/feishu-channel.test.ts`, add this test after `FeishuChannel sends coordinator messages to feishu chat keys`:

```ts
test("FeishuChannel sends scheduled notice and final text", async () => {
  const sent: unknown[] = [];
  const abortController = new AbortController();
  const channel = new FeishuChannel(
    defaultFeishuConfig,
    {
      createClient: () => ({
        sdk: {
          im: {
            message: {
              reply: async (payload: unknown) => {
                sent.push(payload);
                return { data: { message_id: "om_reply", chat_id: "oc_chat" } };
              },
              create: async (payload: unknown) => {
                sent.push(payload);
                return { data: { message_id: "om_created", chat_id: "oc_chat" } };
              },
            },
          },
        },
        probeBot: async () => ({ botOpenId: "ou_bot" }),
        startWS: async () => {},
      }),
    },
  );
  const requests: unknown[] = [];
  const agent: ChatAgent = {
    async chat(request) {
      requests.push(request);
      await request.reply?.("progress");
      return { text: "final answer" };
    },
  };

  await channel.start({ agent, abortSignal: new AbortController().signal, quota: createNoopQuota(), logger: createNoopLogger() });

  await channel.sendScheduledMessage({
    chatKey: "feishu:default:oc_chat",
    sessionAlias: "backend:codex",
    taskId: "k8f2",
    replyContextToken: "om_in",
    noticeText: "执行定时任务 #k8f2",
    promptText: "总结最近一个 commit 内容",
    abortSignal: abortController.signal,
  });

  expect(requests).toHaveLength(1);
  expect(requests[0]).toMatchObject({
    accountId: "default",
    conversationId: "feishu:default:oc_chat",
    text: "总结最近一个 commit 内容",
    replyContextToken: "om_in",
    metadata: { channel: "feishu", scheduledSessionAlias: "backend:codex" },
    abortSignal: abortController.signal,
  });
  expect(sent).toEqual([
    { path: { message_id: "om_in" }, data: { msg_type: "text", content: JSON.stringify({ text: "执行定时任务 #k8f2" }) } },
    { path: { message_id: "om_in" }, data: { msg_type: "text", content: JSON.stringify({ text: "progress" }) } },
    { path: { message_id: "om_in" }, data: { msg_type: "text", content: JSON.stringify({ text: "final answer" }) } },
  ]);
});
```

- [ ] **Step 2: Write failing Feishu failure/media tests**

Add this test:

```ts
test("FeishuChannel scheduled turn sends failure notice and logs unsupported media", async () => {
  const sent: unknown[] = [];
  const errors: Array<{ event: string; message: string; context?: Record<string, unknown> }> = [];
  const channel = new FeishuChannel(
    defaultFeishuConfig,
    {
      createClient: () => ({
        sdk: {
          im: {
            message: {
              reply: async (payload: unknown) => {
                sent.push(payload);
                return { data: { message_id: "om_reply", chat_id: "oc_chat" } };
              },
              create: async (payload: unknown) => {
                sent.push(payload);
                return { data: { message_id: "om_created", chat_id: "oc_chat" } };
              },
            },
          },
        },
        probeBot: async () => ({ botOpenId: "ou_bot" }),
        startWS: async () => {},
      }),
    },
  );

  const logger = {
    info: async () => {},
    error: async (event: string, message: string, context?: Record<string, unknown>) => { errors.push({ event, message, context }); },
    debug: async () => {},
    cleanup: async () => {},
    flush: async () => {},
  } as never;

  await channel.start({
    agent: { async chat() { return { text: "final", media: [{ kind: "image", filePath: "/tmp/a.png" }] as never }; } },
    abortSignal: new AbortController().signal,
    quota: createNoopQuota(),
    logger,
  });

  await channel.sendScheduledMessage({
    chatKey: "feishu:default:oc_chat",
    sessionAlias: "backend:codex",
    taskId: "k8f2",
    replyContextToken: "om_in",
    noticeText: "notice",
    promptText: "prompt",
  });

  expect(sent).toHaveLength(2);
  expect(errors.some((e) => e.event === "feishu.scheduled.media_unsupported" && e.context?.count === 1)).toBe(true);

  await channel.sendScheduledMessage({
    chatKey: "feishu:default:oc_chat",
    sessionAlias: "backend:codex",
    taskId: "fail1",
    replyContextToken: "om_in",
    noticeText: "notice",
    promptText: "prompt",
  }).catch(() => {});
});
```

Then replace the final part with a separate throwing-agent setup so the assertion is exact:

```ts
  const failingChannel = new FeishuChannel(defaultFeishuConfig, { createClient: () => ({ /* same fake client */ }) });
```

Use the same fake client shape, start it with `agent.chat` throwing `new Error("boom")`, call `sendScheduledMessage(...)`, and assert:

```ts
  await expect(failingChannel.sendScheduledMessage({ ... })).rejects.toThrow("boom");
  expect(sent).toContainEqual({
    path: { message_id: "om_in" },
    data: { msg_type: "text", content: JSON.stringify({ text: "⏰ 定时任务 #fail1 执行失败：boom" }) },
  });
```

If the repeated fake client setup gets too long, extract a local helper in this test file:

```ts
function createFeishuTestClient(sent: unknown[]) {
  return {
    sdk: { im: { message: {
      reply: async (payload: unknown) => { sent.push(payload); return { data: { message_id: "om_reply", chat_id: "oc_chat" } }; },
      create: async (payload: unknown) => { sent.push(payload); return { data: { message_id: "om_created", chat_id: "oc_chat" } }; },
    } } },
    probeBot: async () => ({ botOpenId: "ou_bot" }),
    startWS: async () => {},
  };
}
```

- [ ] **Step 3: Run Feishu tests to verify RED**

Run:

```bash
bun test tests/unit/packages/channel-feishu/feishu-channel.test.ts
```

Expected: FAIL because `channel.sendScheduledMessage` is not implemented.

- [ ] **Step 4: Implement Feishu scheduled delivery**

In `packages/channel-feishu/src/channel.ts`, update the plugin API import:

```ts
import type {
  ChannelStartInput,
  CoordinatorMessageInput,
  CreateChannelDeps,
  MessageChannelRuntime,
  OrchestrationDeliveryCallbacks,
  ScheduledChannelMessageInput,
} from "weacpx/plugin-api";
```

Add this helper near the `ActiveTask` interface or as a private method:

```ts
function formatScheduledFailureText(input: ScheduledChannelMessageInput, error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  return input.taskId
    ? `⏰ 定时任务 #${input.taskId} 执行失败：${message}`
    : `⏰ 定时任务执行失败：${message}`;
}
```

Add this method after `sendCoordinatorMessage`:

```ts
  async sendScheduledMessage(input: ScheduledChannelMessageInput): Promise<void> {
    if (!this.agent || !this.logger) {
      throw new Error("FeishuChannel.start() must be called before scheduled message delivery");
    }
    const route = parseFeishuConversationId(input.chatKey);
    if (!route) throw new Error(`cannot deliver Feishu scheduled message to non-Feishu chatKey: ${input.chatKey}`);
    if (!this.accounts.has(route.accountId)) {
      throw new Error(`feishu account "${route.accountId}" is not started; check channel.options.accounts and enabled flags`);
    }

    await this.sendRouteText(input.chatKey, input.replyContextToken, input.noticeText);

    const sendScheduledText = async (text: string): Promise<void> => {
      if (input.abortSignal?.aborted) return;
      const trimmed = text.trim();
      if (trimmed.length === 0) return;
      await this.sendRouteText(input.chatKey, input.replyContextToken, trimmed);
    };

    try {
      const response = await this.agent.chat({
        accountId: route.accountId,
        conversationId: input.chatKey,
        text: input.promptText,
        ...(input.replyContextToken ? { replyContextToken: input.replyContextToken } : {}),
        ...(input.abortSignal ? { abortSignal: input.abortSignal } : {}),
        metadata: { channel: "feishu", scheduledSessionAlias: input.sessionAlias },
        reply: sendScheduledText,
      });

      if (input.abortSignal?.aborted) return;
      if (response.text?.trim()) await sendScheduledText(response.text);
      const media = normalizeMediaArray(response.media);
      if (media.length > 0) {
        await this.logger.error("feishu.scheduled.media_unsupported", "feishu scheduled outbound media is not supported", {
          accountId: route.accountId,
          chatKey: input.chatKey,
          count: media.length,
        });
      }
    } catch (error) {
      await this.sendRouteText(input.chatKey, input.replyContextToken, formatScheduledFailureText(input, error)).catch(() => {});
      throw error;
    }
  }
```

Do not wire scheduled turns into `activeTasks`, streaming cards, typing indicators, or abort fast-path ownership.

- [ ] **Step 5: Run Feishu tests and typecheck**

Run:

```bash
bun test tests/unit/packages/channel-feishu/feishu-channel.test.ts
npx tsc --noEmit
```

Expected: PASS.

- [ ] **Step 6: Commit Feishu implementation**

```bash
git add packages/channel-feishu/src/channel.ts tests/unit/packages/channel-feishu/feishu-channel.test.ts
git commit -m "feat(feishu): support scheduled message delivery"
```

---

### Task 3: Implement Yuanbao scheduled message delivery

**Files:**
- Modify: `packages/channel-yuanbao/src/channel.ts`
- Test: `tests/unit/packages/channel-yuanbao/yuanbao-channel.test.ts`

- [ ] **Step 1: Write failing Yuanbao scheduled delivery test**

In `tests/unit/packages/channel-yuanbao/yuanbao-channel.test.ts`, add this test after `YuanbaoChannel sends coordinator messages via gateway` or after the first inbound reply test:

```ts
test("YuanbaoChannel sends scheduled notice and final text through outbound queue", async () => {
  const sent: unknown[] = [];
  const quotaCalls: string[] = [];
  const abortController = new AbortController();
  const gateway: YuanbaoGateway = {
    start: async () => {},
    sendText: async (input) => { sent.push(input); },
  };
  const channel = new YuanbaoChannel(defaultYuanbaoConfig, { createGateway: () => gateway });
  const requests: unknown[] = [];

  await channel.start({
    agent: {
      async chat(request) {
        requests.push(request);
        await request.reply?.("progress");
        return { text: "final answer" };
      },
    },
    abortSignal: new AbortController().signal,
    quota: { ...createNoopQuota(), onInbound: (chatKey: string) => { quotaCalls.push(chatKey); } },
    logger: createNoopLogger(),
  });

  await channel.sendScheduledMessage({
    chatKey: "yuanbao:default:group:group_001",
    sessionAlias: "backend:codex",
    taskId: "k8f2",
    replyContextToken: "msg_001",
    noticeText: "执行定时任务 #k8f2",
    promptText: "总结最近一个 commit 内容",
    abortSignal: abortController.signal,
  });

  expect(requests).toHaveLength(1);
  expect(requests[0]).toMatchObject({
    accountId: "default",
    conversationId: "yuanbao:default:group:group_001",
    text: "总结最近一个 commit 内容",
    replyContextToken: "msg_001",
    metadata: { channel: "yuanbao", scheduledSessionAlias: "backend:codex" },
    abortSignal: abortController.signal,
  });
  expect(quotaCalls).toEqual([]);
  expect(sent.map((item) => (item as { text: string }).text)).toEqual([
    "执行定时任务 #k8f2",
    "progress\n\nfinal answer",
  ]);
  expect(sent[0]).toMatchObject({ chatType: "group", target: "group_001", replyContextToken: "msg_001" });
});
```

If the queue strategy sends `progress` and `final answer` as separate messages in current defaults, adjust the expectation to the actual strategy by configuring `outboundQueueStrategy` explicitly in the test options. For deterministic merge-on-flush behavior, instantiate the channel with:

```ts
const channel = new YuanbaoChannel({ ...defaultYuanbaoConfig, outboundQueueStrategy: "merge-on-flush" }, { createGateway: () => gateway });
```

- [ ] **Step 2: Write failing Yuanbao reply fallback and failure tests**

Add this test:

```ts
test("YuanbaoChannel scheduled delivery retries without reply token and reports failures", async () => {
  const sent: unknown[] = [];
  let failQuotedSends = true;
  const gateway: YuanbaoGateway = {
    start: async () => {},
    sendText: async (input) => {
      if (failQuotedSends && input.replyContextToken) throw new Error("quote expired");
      sent.push(input);
    },
  };

  const channel = new YuanbaoChannel(defaultYuanbaoConfig, { createGateway: () => gateway });
  await channel.start({
    agent: { async chat() { return { text: "final" }; } },
    abortSignal: new AbortController().signal,
    quota: createNoopQuota(),
    logger: createNoopLogger(),
  });

  await channel.sendScheduledMessage({
    chatKey: "yuanbao:default:group:group_001",
    sessionAlias: "backend:codex",
    taskId: "k8f2",
    replyContextToken: "msg_expired",
    noticeText: "notice",
    promptText: "prompt",
  });

  expect(sent.length).toBeGreaterThan(0);
  expect(sent.every((item) => !(item as { replyContextToken?: string }).replyContextToken)).toBe(true);

  failQuotedSends = false;
  const failingChannel = new YuanbaoChannel(defaultYuanbaoConfig, { createGateway: () => gateway });
  await failingChannel.start({
    agent: { async chat() { throw new Error("boom"); } },
    abortSignal: new AbortController().signal,
    quota: createNoopQuota(),
    logger: createNoopLogger(),
  });

  await expect(failingChannel.sendScheduledMessage({
    chatKey: "yuanbao:default:group:group_001",
    sessionAlias: "backend:codex",
    taskId: "fail1",
    replyContextToken: "msg_001",
    noticeText: "notice",
    promptText: "prompt",
  })).rejects.toThrow("boom");

  expect(sent.some((item) => (item as { text: string }).text === "⏰ 定时任务 #fail1 执行失败：boom")).toBe(true);
});
```

- [ ] **Step 3: Run Yuanbao tests to verify RED**

Run:

```bash
bun test tests/unit/packages/channel-yuanbao/yuanbao-channel.test.ts
```

Expected: FAIL because `channel.sendScheduledMessage` is not implemented.

- [ ] **Step 4: Implement Yuanbao scheduled delivery imports and helper**

In `packages/channel-yuanbao/src/channel.ts`, update imports from plugin API:

```ts
import type {
  ChannelStartInput,
  CoordinatorMessageInput,
  MessageChannelRuntime,
  OrchestrationDeliveryCallbacks,
  ScheduledChannelMessageInput,
} from "weacpx/plugin-api";
```

Add this helper near constants:

```ts
function formatScheduledFailureText(input: ScheduledChannelMessageInput, error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  return input.taskId
    ? `⏰ 定时任务 #${input.taskId} 执行失败：${message}`
    : `⏰ 定时任务执行失败：${message}`;
}
```

- [ ] **Step 5: Add reply-token fallback to text send helpers**

Change `sendTextChunks` input type to include:

```ts
    retryWithoutReplyContextOnError?: boolean;
```

Inside `sendTextChunks`, replace the direct `gateway.sendText` call with:

```ts
      const replyContextToken = this.resolveReplyContextToken({
        account: input.account,
        routeKey,
        replyContextToken: input.replyContextToken,
      });
      try {
        await this.gateway.sendText({
          account: input.account,
          chatType: input.chatType,
          target: input.target,
          text: chunk,
          ...(replyContextToken ? { replyContextToken } : {}),
        });
      } catch (error) {
        if (input.retryWithoutReplyContextOnError && replyContextToken) {
          await this.gateway.sendText({
            account: input.account,
            chatType: input.chatType,
            target: input.target,
            text: chunk,
          });
          continue;
        }
        throw error;
      }
```

Change `createTurnQueue` input type to include:

```ts
    retryWithoutReplyContextOnError?: boolean;
```

Inside the queue `sendText` callback, replace the direct gateway send with the same try/retry pattern using `input.retryWithoutReplyContextOnError`.

Existing non-scheduled calls must not pass this option, so their behavior remains unchanged.

- [ ] **Step 6: Implement Yuanbao `sendScheduledMessage`**

Add this method after `sendCoordinatorMessage`:

```ts
  async sendScheduledMessage(input: ScheduledChannelMessageInput): Promise<void> {
    if (!this.agent || !this.gateway || !this.logger) {
      throw new Error("YuanbaoChannel.start() must be called before scheduled message delivery");
    }
    if (this.isAborted()) return;
    const route = parseYuanbaoChatKey(input.chatKey);
    if (!route) throw new Error(`cannot deliver Yuanbao scheduled message to non-Yuanbao chatKey: ${input.chatKey}`);
    const account = this.accountById(route.accountId);
    if (!account) throw new Error(`unknown Yuanbao account in chatKey: ${route.accountId}`);

    await this.sendTextChunks({
      account,
      chatType: route.chatType,
      target: route.target,
      text: input.noticeText,
      replyContextToken: input.replyContextToken,
      retryWithoutReplyContextOnError: true,
    });

    const queue = this.createTurnQueue({
      account,
      chatType: route.chatType,
      target: route.target,
      replyContextToken: input.replyContextToken,
      retryWithoutReplyContextOnError: true,
    });

    try {
      const response = await this.agent.chat({
        accountId: account.accountId,
        conversationId: input.chatKey,
        text: input.promptText,
        ...(input.replyContextToken ? { replyContextToken: input.replyContextToken } : {}),
        ...(input.abortSignal ? { abortSignal: input.abortSignal } : this.abortSignal ? { abortSignal: this.abortSignal } : {}),
        metadata: { channel: "yuanbao", scheduledSessionAlias: input.sessionAlias },
        reply: async (text) => {
          if (this.isAborted() || input.abortSignal?.aborted) return;
          await queue.push(text);
        },
      });

      if (this.isAborted() || input.abortSignal?.aborted) {
        queue.abort();
        return;
      }
      if (response.text) await queue.push(response.text);
      await queue.flush();

      const media = normalizeMediaArray(response.media);
      if (media.length > 0) {
        await this.logger.error("yuanbao.scheduled.media_unsupported", "yuanbao scheduled outbound media is not supported by the current gateway adapter", { count: media.length });
      }
    } catch (error) {
      queue.abort();
      await this.sendTextChunks({
        account,
        chatType: route.chatType,
        target: route.target,
        text: formatScheduledFailureText(input, error),
        replyContextToken: input.replyContextToken,
        retryWithoutReplyContextOnError: true,
      }).catch(() => {});
      throw error;
    }
  }
```

- [ ] **Step 7: Run Yuanbao tests and typecheck**

Run:

```bash
bun test tests/unit/packages/channel-yuanbao/yuanbao-channel.test.ts
npx tsc --noEmit
```

Expected: PASS.

- [ ] **Step 8: Commit Yuanbao implementation**

```bash
git add packages/channel-yuanbao/src/channel.ts tests/unit/packages/channel-yuanbao/yuanbao-channel.test.ts
git commit -m "feat(yuanbao): support scheduled message delivery"
```

---

### Task 4: Cross-channel scheduled capability integration tests and docs alignment

**Files:**
- Modify: `tests/unit/scheduled/scheduled-channel-turn.test.ts`
- Modify: `docs/later-command.md`

- [ ] **Step 1: Add registry support assertion for real plugin channels**

In `tests/unit/scheduled/scheduled-channel-turn.test.ts`, import plugin channels:

```ts
import { FeishuChannel } from "../../../packages/channel-feishu/src/channel";
import { YuanbaoChannel } from "../../../packages/channel-yuanbao/src/channel";
```

Add this test after `ChannelRegistry reports scheduled-message support by chatKey`:

```ts
test("first-party plugin channels advertise scheduled-message support", () => {
  const registry = new MessageChannelRegistry([
    new FeishuChannel({ appId: "app", appSecret: "secret" }),
    new YuanbaoChannel({ appKey: "key", appSecret: "secret", botId: "bot" }),
  ]);

  expect(registry.supportsScheduledMessages("feishu:default:oc_chat123")).toBe(true);
  expect(registry.supportsScheduledMessages("yuanbao:default:group:group_123")).toBe(true);
});
```

- [ ] **Step 2: Run test to verify RED or GREEN depending on task order**

Run:

```bash
bun test tests/unit/scheduled/scheduled-channel-turn.test.ts
```

Expected after Tasks 2 and 3: PASS. If this is run before channel implementation, it should FAIL because the channels do not yet implement `sendScheduledMessage`.

- [ ] **Step 3: Update later command docs with supported first-party channels**

In `docs/later-command.md`, in the “心智模型” section after the bullet about scheduled-message delivery support, add:

```md
  - 内置微信频道、Feishu 插件频道、Yuanbao 插件频道支持该能力；第三方频道需要实现 `sendScheduledMessage` 后才会允许创建 `/lt` 任务。
```

- [ ] **Step 4: Run docs diff check and tests**

Run:

```bash
git diff --check -- docs/later-command.md tests/unit/scheduled/scheduled-channel-turn.test.ts
bun test tests/unit/scheduled/scheduled-channel-turn.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit integration/docs**

```bash
git add tests/unit/scheduled/scheduled-channel-turn.test.ts docs/later-command.md
git commit -m "test: advertise plugin scheduled channel support"
```

---

### Task 5: Build generated package artifacts

**Files:**
- Modify generated: `dist/*`
- Modify generated: `packages/channel-feishu/dist/*`
- Modify generated: `packages/channel-yuanbao/dist/*`

- [ ] **Step 1: Build all packages**

Run:

```bash
bun run build:packages
```

Expected: PASS. This rebuilds root `dist`, Feishu plugin `dist`, and Yuanbao plugin `dist` with updated types and runtime code.

- [ ] **Step 2: Verify generated metadata contains 0.5.0 declarations**

Run:

```bash
grep -R "minWeacpxVersion: \"0.5.0\"\|sendScheduledMessage\|ScheduledChannelMessageInput" -n dist packages/channel-feishu/dist packages/channel-yuanbao/dist | head -80
```

Expected: output includes plugin dist `minWeacpxVersion: "0.5.0"`, channel dist `sendScheduledMessage`, and root plugin-api declarations for `ScheduledChannelMessageInput`.

- [ ] **Step 3: Commit generated artifacts**

```bash
git add dist packages/channel-feishu/dist packages/channel-yuanbao/dist
git commit -m "build: refresh 0.5 scheduled plugin artifacts"
```

If generated `dist` files are not tracked in this repository, `git status --short dist packages/channel-feishu/dist packages/channel-yuanbao/dist` will be empty; in that case do not create an empty commit and note that build artifacts are ignored/untracked.

---

### Task 6: Final verification

**Files:**
- Verify all changed source, tests, package metadata, docs, and generated artifacts.

- [ ] **Step 1: Run focused channel and metadata tests**

```bash
bun test \
  tests/unit/plugins/plugin-api-types.test.ts \
  tests/unit/packages/package-metadata.test.ts \
  tests/unit/packages/channel-feishu/feishu-plugin.test.ts \
  tests/unit/packages/channel-feishu/feishu-channel.test.ts \
  tests/unit/packages/channel-yuanbao/yuanbao-plugin.test.ts \
  tests/unit/packages/channel-yuanbao/yuanbao-channel.test.ts \
  tests/unit/scheduled/scheduled-channel-turn.test.ts
```

Expected: PASS.

- [ ] **Step 2: Run full unit test suite**

```bash
npm run test:unit
```

Expected: PASS.

- [ ] **Step 3: Run full package build and publish verification**

```bash
bun run verify:publish
```

Expected: PASS. This covers root build, plugin builds, and publish layout checks.

- [ ] **Step 4: Manual dry-run supported channel sanity**

Run the existing Weixin dry-run to ensure core `/lt` behavior still creates tasks:

```bash
bun run dry-run --chat-key wx:test -- "/ws new backend -d /Users/maijiazhen/Projects/weacpx-github" "/session new demo --agent codex --ws backend" "/lt in 1m summarize current session"
```

Expected: output includes `已创建定时任务`.

- [ ] **Step 5: Inspect final version and compatibility metadata**

```bash
node -e "const fs=require('fs'); for (const p of ['package.json','packages/channel-feishu/package.json','packages/channel-yuanbao/package.json']) { const j=JSON.parse(fs.readFileSync(p)); console.log(p, j.version, j.peerDependencies?.weacpx); }"
grep -R "minWeacpxVersion: \"0.5.0\"" -n packages/channel-feishu/src packages/channel-yuanbao/src src/plugins
```

Expected:

```text
package.json 0.5.0 undefined
packages/channel-feishu/package.json 0.1.2 >=0.5.0-0
packages/channel-yuanbao/package.json 0.1.1 >=0.5.0-0
```

And grep shows `0.5.0` in both plugin `src/index.ts` files plus the core compatibility constant.

- [ ] **Step 6: Final code review**

Request a final review over the full diff. Reviewer should verify:

- Feishu and Yuanbao both implement `sendScheduledMessage`.
- Scheduled turns pass `scheduledSessionAlias`, `taskId`, and `abortSignal`.
- `replyContextToken` is treated as a creation-time snapshot with fallback where needed.
- Plugin versions remain independent while min core and peer deps require `0.5.0`.
- No core scheduler behavior regressed.

- [ ] **Step 7: Final commit for verification fixes only**

If verification required fixes, commit them:

```bash
git add .
git commit -m "fix: finalize scheduled plugin support"
```

If no files changed during verification, do not create an empty commit.

---

## Self-Review

**Spec coverage:** This plan covers core `0.5.0` versioning, public plugin API export, task id propagation, Feishu scheduled delivery, Yuanbao scheduled delivery, reply token snapshot/fallback behavior, abort signal propagation, unsupported media logging, quota independence tests, docs alignment, generated artifacts, and full verification.

**Placeholder scan:** No placeholder tasks remain. Every implementation task has exact file paths, code snippets, commands, and expected outcomes.

**Type consistency:** `ScheduledChannelMessageInput.taskId?: string` is added in `src/channels/types.ts`, exported from `src/plugin-api.ts`, passed from `src/main.ts`, and consumed by both plugin channel implementations.
