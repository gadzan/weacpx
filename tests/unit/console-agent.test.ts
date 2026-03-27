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
