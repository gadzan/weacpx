import { expect, mock, test } from "bun:test";
import { CommandRouter } from "../../../src/commands/command-router";
import {
  MemoryStateStore,
  SessionService,
  createConfig,
  createEmptyState,
  createTransport,
  getCancelMock,
} from "./command-router-test-support";

test("CommandRouter.handle fires transport.cancel when abortSignal fires during prompt", async () => {
  const sessions = new SessionService(createConfig(), new MemoryStateStore(), createEmptyState());
  const transport = createTransport();

  let resolvePrompt = (): void => {};
  const promptStarted = new Promise<void>((resolve) => {
    transport.prompt = mock(async () => {
      resolve();
      await new Promise<void>((r) => {
        resolvePrompt = r;
      });
      return { text: "agent done" };
    });
  });

  const router = new CommandRouter(sessions, transport);
  await router.handle("wx:user", "/session new api-fix --agent codex --ws backend");

  const controller = new AbortController();
  const inflight = router.handle(
    "wx:user",
    "long running prompt",
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    controller.signal,
  );
  await promptStarted;
  controller.abort();

  // give the abort listener a tick to fire cancel
  await new Promise((r) => setTimeout(r, 5));
  expect(getCancelMock(transport).mock.calls.length).toBeGreaterThanOrEqual(1);

  resolvePrompt();
  await inflight;
});

test("CommandRouter.handle without abortSignal does not invoke transport.cancel", async () => {
  const sessions = new SessionService(createConfig(), new MemoryStateStore(), createEmptyState());
  const transport = createTransport();
  const router = new CommandRouter(sessions, transport);

  await router.handle("wx:user", "/session new api-fix --agent codex --ws backend");
  await router.handle("wx:user", "regular prompt");

  expect(getCancelMock(transport).mock.calls.length).toBe(0);
});

test("CommandRouter.handle with already-aborted signal short-circuits without calling transport.prompt", async () => {
  const sessions = new SessionService(createConfig(), new MemoryStateStore(), createEmptyState());
  const transport = createTransport();
  const promptMock = mock(async () => ({ text: "should not reach" }));
  transport.prompt = promptMock;

  const router = new CommandRouter(sessions, transport);
  await router.handle("wx:user", "/session new api-fix --agent codex --ws backend");

  const controller = new AbortController();
  controller.abort();

  let caught: unknown;
  try {
    await router.handle(
      "wx:user",
      "ignored",
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      controller.signal,
    );
  } catch (error) {
    caught = error;
  }
  expect(promptMock.mock.calls.length).toBe(0);
  expect(getCancelMock(transport).mock.calls.length).toBe(0);
  expect((caught as { name?: string } | undefined)?.name).toBe("AbortError");
});

test("CommandRouter.handle does NOT call transport.cancel when abort fires after prompt resolves", async () => {
  const sessions = new SessionService(createConfig(), new MemoryStateStore(), createEmptyState());
  const transport = createTransport();
  transport.prompt = mock(async () => ({ text: "fast done" }));

  const router = new CommandRouter(sessions, transport);
  await router.handle("wx:user", "/session new api-fix --agent codex --ws backend");

  const controller = new AbortController();
  await router.handle(
    "wx:user",
    "fast prompt",
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    controller.signal,
  );
  // prompt already resolved; firing abort now must not trigger cancel.
  controller.abort();
  await new Promise((r) => setTimeout(r, 10));
  expect(getCancelMock(transport).mock.calls.length).toBe(0);
});

test("CommandRouter.handle marks prompt_done aborted when signal is already aborted", async () => {
  const sessions = new SessionService(createConfig(), new MemoryStateStore(), createEmptyState());
  const transport = createTransport();
  const router = new CommandRouter(sessions, transport);
  await router.handle("wx:user", "/session new api-fix --agent codex --ws backend");

  const marks: Array<{ event: string; context?: Record<string, unknown> }> = [];
  const perfSpan = {
    traceId: "trace-abort",
    mark: (event: string, context?: Record<string, unknown>) => marks.push({ event, context }),
    setOutcome: () => {},
  };
  const controller = new AbortController();
  controller.abort();

  await expect(
    router.handle("wx:user", "ignored", undefined, undefined, undefined, undefined, undefined, controller.signal, undefined, perfSpan),
  ).rejects.toThrow();

  expect(marks.at(-1)).toEqual({ event: "transport.prompt_done", context: { localOutcome: "aborted" } });
});

test("CommandRouter.handle marks prompt_done aborted when abort fires during a prompt that resolves", async () => {
  const sessions = new SessionService(createConfig(), new MemoryStateStore(), createEmptyState());
  const transport = createTransport();

  let resolvePrompt = (): void => {};
  const promptStarted = new Promise<void>((resolve) => {
    transport.prompt = mock(async () => {
      resolve();
      await new Promise<void>((r) => {
        resolvePrompt = r;
      });
      return { text: "agent done" };
    });
  });

  const router = new CommandRouter(sessions, transport);
  await router.handle("wx:user", "/session new api-fix --agent codex --ws backend");

  const marks: Array<{ event: string; context?: Record<string, unknown> }> = [];
  const perfSpan = {
    traceId: "trace-abort",
    mark: (event: string, context?: Record<string, unknown>) => marks.push({ event, context }),
    setOutcome: () => {},
  };
  const controller = new AbortController();
  const inflight = router.handle(
    "wx:user",
    "long running prompt",
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    controller.signal,
    undefined,
    perfSpan,
  );
  await promptStarted;
  controller.abort();
  await new Promise((r) => setTimeout(r, 5));
  resolvePrompt();
  await inflight;

  expect(marks.at(-1)).toEqual({ event: "transport.prompt_done", context: { localOutcome: "aborted" } });
});
