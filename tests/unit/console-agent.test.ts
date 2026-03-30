import { expect, test } from "bun:test";

import { ConsoleAgent } from "../../src/console-agent";

test("passes the conversation id and text into the command router", async () => {
  const events: string[] = [];
  const agent = new ConsoleAgent({
    handle: async (conversationId, text) => ({
      text: `${conversationId}:${text}`,
    }),
  }, {
    info: async (event, _message, context) => {
      events.push(`${event}:${context?.chatKey}:${context?.kind}`);
    },
    debug: async () => {},
    error: async () => {},
    cleanup: async () => {},
  });

  const response = await agent.chat({
    conversationId: "wx:user",
    text: "/help",
  });

  expect(response.text).toBe("wx:user:/help");
  expect(events).toEqual(["chat.received:wx:user:command"]);
});

test("delegates clearSession to the command router", async () => {
  const calls: string[] = [];
  let resolved = false;
  const agent = new ConsoleAgent(
    {
      handle: async () => ({ text: "ok" }),
      clearSession: async (conversationId) => {
        calls.push(conversationId);
        await new Promise((resolve) => setTimeout(resolve, 0));
        resolved = true;
      },
    },
    {
      info: async () => {},
      debug: async () => {},
      error: async () => {},
      cleanup: async () => {},
    },
  );

  const pending = agent.clearSession?.("wx:user");

  expect(resolved).toBe(false);
  await pending;
  expect(calls).toEqual(["wx:user"]);
  expect(resolved).toBe(true);
});
