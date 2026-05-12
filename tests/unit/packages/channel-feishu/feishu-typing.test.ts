import { expect, test } from "bun:test";

import {
  addTypingIndicator,
  removeTypingIndicator,
  type FeishuReactionClient,
} from "../../../../packages/channel-feishu/src/typing";

test("addTypingIndicator sends 'Typing' reaction and captures reaction_id", async () => {
  const calls: unknown[] = [];
  const client: FeishuReactionClient = {
    im: {
      messageReaction: {
        create: async (payload) => {
          calls.push(payload);
          return { data: { reaction_id: "rx_1" } };
        },
        delete: async () => ({}),
      },
    },
  };

  const state = await addTypingIndicator({ client, messageId: "om_in" });

  expect(state).toEqual({ messageId: "om_in", reactionId: "rx_1" });
  expect(calls).toEqual([
    {
      path: { message_id: "om_in" },
      data: { reaction_type: { emoji_type: "Typing" } },
    },
  ]);
});

test("addTypingIndicator swallows errors and returns null reactionId", async () => {
  const client: FeishuReactionClient = {
    im: {
      messageReaction: {
        create: async () => {
          throw new Error("boom");
        },
        delete: async () => ({}),
      },
    },
  };

  const state = await addTypingIndicator({ client, messageId: "om_in" });
  expect(state).toEqual({ messageId: "om_in", reactionId: null });
});

test("addTypingIndicator no-ops when messageReaction API is absent", async () => {
  const client: FeishuReactionClient = { im: {} };
  const state = await addTypingIndicator({ client, messageId: "om_in" });
  expect(state).toEqual({ messageId: "om_in", reactionId: null });
});

test("removeTypingIndicator deletes the previously added reaction", async () => {
  const calls: unknown[] = [];
  const client: FeishuReactionClient = {
    im: {
      messageReaction: {
        create: async () => ({ data: { reaction_id: "rx_1" } }),
        delete: async (payload) => {
          calls.push(payload);
          return {};
        },
      },
    },
  };

  await removeTypingIndicator({ client, state: { messageId: "om_in", reactionId: "rx_1" } });

  expect(calls).toEqual([{ path: { message_id: "om_in", reaction_id: "rx_1" } }]);
});

test("removeTypingIndicator skips when reactionId is null", async () => {
  let called = false;
  const client: FeishuReactionClient = {
    im: {
      messageReaction: {
        create: async () => ({ data: { reaction_id: "rx_1" } }),
        delete: async () => {
          called = true;
          return {};
        },
      },
    },
  };

  await removeTypingIndicator({ client, state: { messageId: "om_in", reactionId: null } });
  expect(called).toBe(false);
});

test("removeTypingIndicator swallows errors", async () => {
  const client: FeishuReactionClient = {
    im: {
      messageReaction: {
        create: async () => ({ data: { reaction_id: "rx_1" } }),
        delete: async () => {
          throw new Error("network");
        },
      },
    },
  };

  await expect(
    removeTypingIndicator({ client, state: { messageId: "om_in", reactionId: "rx_1" } }),
  ).resolves.toBeUndefined();
});
