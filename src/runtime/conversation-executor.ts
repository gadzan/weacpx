export type ConversationExecutorLane = "normal" | "control";

type ConversationTask<T> = () => Promise<T>;

type ConversationState = {
  normalTails: Map<string, Promise<unknown>>;
  activeControls: number;
};

const DEFAULT_SESSION_KEY = "__chat__";

export type ConversationExecutor = {
  run<T>(
    conversationId: string,
    lane: ConversationExecutorLane,
    task: ConversationTask<T>,
    sessionKey?: string,
  ): Promise<T>;
};

export function createConversationExecutor(): ConversationExecutor {
  const states = new Map<string, ConversationState>();

  const getState = (conversationId: string): ConversationState => {
    const existing = states.get(conversationId);
    if (existing) return existing;
    const created: ConversationState = { normalTails: new Map(), activeControls: 0 };
    states.set(conversationId, created);
    return created;
  };

  const cleanupState = (conversationId: string, state: ConversationState) => {
    if (state.normalTails.size === 0 && state.activeControls === 0) {
      states.delete(conversationId);
    }
  };

  return {
    run<T>(
      conversationId: string,
      lane: ConversationExecutorLane,
      task: ConversationTask<T>,
      sessionKey?: string,
    ): Promise<T> {
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

      const key = sessionKey ?? DEFAULT_SESSION_KEY;
      const previous = state.normalTails.get(key) ?? Promise.resolve();
      const next: Promise<T> = previous.then(
        () => task(),
        () => task(),
      );
      state.normalTails.set(key, next);

      return next.finally(() => {
        if (state.normalTails.get(key) === next) {
          state.normalTails.delete(key);
        }
        cleanupState(conversationId, state);
      });
    },
  };
}
