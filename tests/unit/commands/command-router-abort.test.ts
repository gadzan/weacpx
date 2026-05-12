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
