import type { AppLogger } from "../logging/app-logger";
import type { ToolUseEvent } from "../channels/types";

export type ControlEvent =
  | { type: "turn-output"; chatKey: string; sessionAlias: string; chunk: string }
  | { type: "turn-started"; chatKey: string; sessionAlias: string }
  | { type: "tool-event"; chatKey: string; sessionAlias: string; event: ToolUseEvent }
  | { type: "turn-thought"; chatKey: string; sessionAlias: string; chunk: string }
  | { type: "turn-finished"; chatKey: string; sessionAlias: string; ok: boolean; errorMessage?: string; cancelled?: boolean }
  | { type: "sessions-changed" }
  | { type: "scheduled-changed"; chatKey: string }
  | { type: "orchestration-changed" };

export type ControlEventListener = (event: ControlEvent) => void;

export interface ControlEventBus {
  subscribe(listener: ControlEventListener): () => void;
  emit(event: ControlEvent): void;
}

export function createControlEventBus(logger?: AppLogger): ControlEventBus {
  const listeners = new Set<ControlEventListener>();
  return {
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    emit(event) {
      for (const listener of [...listeners]) {
        try {
          listener(event);
        } catch (error) {
          void logger?.error("control.event_listener_failed", "control event listener threw", {
            eventType: event.type,
            error: error instanceof Error ? error.message : String(error),
          });
        }
      }
    },
  };
}
