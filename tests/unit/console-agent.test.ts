import { expect, test } from "bun:test";

import { ConsoleAgent } from "../../src/console-agent";

test("passes the conversation id and text into the command router", async () => {
  const agent = new ConsoleAgent({
    handle: async (conversationId, text) => ({
      text: `${conversationId}:${text}`,
    }),
  });

  const response = await agent.chat({
    conversationId: "wx:user",
    text: "/help",
  });

  expect(response.text).toBe("wx:user:/help");
});
