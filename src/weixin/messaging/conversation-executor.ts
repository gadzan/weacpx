export type ConversationExecutorLane = "normal" | "control";

type ConversationTask<T> = () => Promise<T>;

type ConversationState = {
  normalTail?: Promise<unknown>;
  activeControls: number;
};

export type ConversationExecutor = {
  run<T>(conversationId: string, lane: ConversationExecutorLane, task: ConversationTask<T>): Promise<T>;
};

export function createConversationExecutor(): ConversationExecutor {
  const states = new Map<string, ConversationState>();

  const getState = (conversationId: string): ConversationState => {
    const existing = states.get(conversationId);
    if (existing) return existing;
    const created: ConversationState = { activeControls: 0 };
    states.set(conversationId, created);
    return created;
  };

  const cleanupState = (conversationId: string, state: ConversationState) => {
    if (!state.normalTail && state.activeControls === 0) {
      states.delete(conversationId);
    }
  };

  return {
    run<T>(conversationId: string, lane: ConversationExecutorLane, task: ConversationTask<T>): Promise<T> {
      const state = getState(conversationId);

      if (lane === "control") {
        state.activeControls += 1;
        return Promise.resolve()
          .then(task)
          .finally(() => {
            state.activeControls -= 1;
            cleanupState(conversationId, state);
          });
      }

      const previous = state.normalTail ?? Promise.resolve();
      const next = previous.catch(() => undefined).then(task);
      state.normalTail = next;

      return next.finally(() => {
        if (state.normalTail === next) {
          state.normalTail = undefined;
        }
        cleanupState(conversationId, state);
      });
    },
  };
}
