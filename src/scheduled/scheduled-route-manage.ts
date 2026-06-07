import { stableCoordinatorSession } from "../orchestration/coordinator-identity";
import type { OrchestrationCoordinatorRouteContextRecord } from "../orchestration/orchestration-types";
import type { AppState } from "../state/types";
import { normalizeId } from "./scheduled-service";
import type { ScheduledTaskRecord } from "./scheduled-types";

export interface ScheduledListFromRouteInput {
  coordinatorSession: string;
}

export interface ScheduledListFromRouteDeps {
  state: Pick<AppState, "orchestration">;
  scheduled: { listPending: () => ScheduledTaskRecord[] };
}

export interface ScheduledCancelFromRouteInput {
  coordinatorSession: string;
  id: string;
}

export interface ScheduledCancelFromRouteDeps {
  state: Pick<AppState, "orchestration">;
  scheduled: { cancelPending: (id: string) => Promise<boolean> };
}

export async function listScheduledTasksFromRoute(
  input: ScheduledListFromRouteInput,
  deps: ScheduledListFromRouteDeps,
): Promise<ScheduledTaskRecord[]> {
  resolveOwnedCoordinatorRoute(input.coordinatorSession, deps.state, "scheduled_list");
  return deps.scheduled.listPending();
}

export async function cancelScheduledTaskFromRoute(
  input: ScheduledCancelFromRouteInput,
  deps: ScheduledCancelFromRouteDeps,
): Promise<{ id: string; cancelled: boolean }> {
  resolveOwnedCoordinatorRoute(input.coordinatorSession, deps.state, "scheduled_cancel");
  const cancelled = await deps.scheduled.cancelPending(input.id);
  return { id: normalizeId(input.id), cancelled };
}

// Shared gate for the route-scoped management tools: the coordinator must have a
// recorded chat route, the chat must be a direct/group chat, and group chats are
// owner-only. `label` is the tool name so error messages are tool-specific.
function resolveOwnedCoordinatorRoute(
  coordinatorSession: string,
  state: Pick<AppState, "orchestration">,
  label: string,
): OrchestrationCoordinatorRouteContextRecord {
  const session = coordinatorSession.trim();
  if (session.length === 0) {
    throw new Error("coordinatorSession must be a non-empty string");
  }
  const route = state.orchestration.coordinatorRoutes[stableCoordinatorSession(session)];
  if (!route) {
    throw new Error(`no chat route is recorded for coordinator session "${session}"`);
  }
  if (route.chatType !== "direct" && route.chatType !== "group") {
    throw new Error(`${label} requires current chat route metadata`);
  }
  if (route.chatType === "group" && route.isOwner !== true) {
    throw new Error(`${label} is owner-only in group chats`);
  }
  return route;
}
