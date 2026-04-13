export type BridgeRequestLane = "normal" | "control";

type Task<T> = () => T | Promise<T>;

interface SessionState {
  pendingNormals: number;
  tail: Promise<void>;
}

export class BridgeRequestScheduler {
  private readonly sessions = new Map<string, SessionState>();

  run<T>(sessionName: string, lane: BridgeRequestLane, task: Task<T>): Promise<T> {
    if (lane === "control") {
      return Promise.resolve().then(task);
    }

    const state = this.sessions.get(sessionName) ?? this.createSessionState(sessionName);
    state.pendingNormals += 1;

    const result = state.tail.then(() => task());
    state.tail = result.then(
      () => undefined,
      () => undefined,
    );

    return result.finally(() => {
      state.pendingNormals -= 1;
      if (state.pendingNormals === 0 && this.sessions.get(sessionName) === state) {
        this.sessions.delete(sessionName);
      }
    });
  }

  private createSessionState(sessionName: string): SessionState {
    const state: SessionState = {
      pendingNormals: 0,
      tail: Promise.resolve(),
    };
    this.sessions.set(sessionName, state);
    return state;
  }
}
