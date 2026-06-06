import type { AppConfig } from "../config/types";
import { stableCoordinatorSession } from "../orchestration/coordinator-identity";
import type { AppState } from "../state/types";
import type { ResolvedSession } from "../transport/types";
import { parseLaterTime, type LaterTimeParseErrorCode } from "./parse-later-time";
import type { CreateScheduledTaskInput } from "./scheduled-service";
import type { ScheduledSessionMode, ScheduledTaskRecord } from "./scheduled-types";

export interface ScheduledCreateFromRouteInput {
  coordinatorSession: string;
  timeText: string;
  message: string;
  mode?: ScheduledSessionMode;
}

export interface ScheduledCreateFromRouteDeps {
  state: Pick<AppState, "orchestration">;
  config: Pick<AppConfig, "later">;
  sessions: {
    getSession: (alias: string) => Promise<ResolvedSession | null>;
    getPreferredSessionForTransport: (transportSession: string) => Promise<ResolvedSession | null>;
  };
  scheduled: {
    createTask: (input: CreateScheduledTaskInput) => Promise<ScheduledTaskRecord>;
  };
  supportsScheduledMessages?: (chatKey: string) => boolean;
  now?: () => Date;
}

export async function createScheduledTaskFromRoute(
  input: ScheduledCreateFromRouteInput,
  deps: ScheduledCreateFromRouteDeps,
): Promise<ScheduledTaskRecord> {
  const coordinatorSession = input.coordinatorSession.trim();
  if (coordinatorSession.length === 0) {
    throw new Error("coordinatorSession must be a non-empty string");
  }

  const route = deps.state.orchestration.coordinatorRoutes[coordinatorSession];
  if (!route) {
    throw new Error(`no chat route is recorded for coordinator session "${coordinatorSession}"`);
  }
  if (route.chatType !== "direct" && route.chatType !== "group") {
    throw new Error("scheduled_create requires current chat route metadata");
  }
  if (route.chatType === "group" && route.isOwner !== true) {
    throw new Error("scheduled_create is owner-only in group chats");
  }
  if (deps.supportsScheduledMessages && !deps.supportsScheduledMessages(route.chatKey)) {
    throw new Error("current channel does not support scheduled tasks");
  }

  const message = input.message.trim();
  if (message.length === 0) {
    throw new Error("message must be a non-empty string");
  }
  if (message.startsWith("/")) {
    throw new Error("scheduled_create does not support slash-prefixed xacpx commands");
  }

  if (!route.sessionAlias) {
    throw new Error("scheduled_create requires current session route metadata");
  }
  const session = await deps.sessions.getSession(route.sessionAlias);
  if (!session) {
    throw new Error(`session "${route.sessionAlias}" recorded for coordinator session "${coordinatorSession}" was not found`);
  }
  if (stableCoordinatorSession(session.transportSession) !== stableCoordinatorSession(coordinatorSession)) {
    throw new Error(
      `session "${route.sessionAlias}" is no longer attached to coordinator session "${coordinatorSession}"`,
    );
  }

  const executeAt = parseRouteScheduledTime(input.timeText, deps.now?.() ?? new Date());
  const mode = input.mode ?? (deps.config.later?.defaultMode === "bind" ? "bound" : "temp");
  return await deps.scheduled.createTask({
    chatKey: route.chatKey,
    sessionAlias: session.alias,
    executeAt,
    message,
    sessionMode: mode,
    ...(mode === "temp" ? { agent: session.agent, workspace: session.workspace } : {}),
    ...(route.accountId ? { accountId: route.accountId } : {}),
    ...(route.replyContextToken ? { replyContextToken: route.replyContextToken } : {}),
    sourceLabel: "mcp:scheduled_create",
  });
}

function parseRouteScheduledTime(timeText: string, now: Date): Date {
  const timeTokens = timeText.trim().split(/\s+/).filter((token) => token.length > 0);
  if (timeTokens.length === 0) {
    throw new Error(formatLaterTimeParseError("missing_time"));
  }

  // parseLaterTime expects the message to follow the time tokens because the
  // slash command syntax is `/lt <time> <message>`. The MCP tool carries the
  // message in a separate argument, so append a sentinel message token for
  // validation, then ensure the parsed time consumed the entire timeText.
  const parsed = parseLaterTime([...timeTokens, "__scheduled_create_message__"], now);
  if (!parsed.ok) {
    throw new Error(formatLaterTimeParseError(parsed.code, parsed.value));
  }
  if (parsed.messageStartIndex !== timeTokens.length) {
    throw new Error("timeText must contain only the time expression; put the scheduled content in message");
  }
  return parsed.executeAt;
}

function formatLaterTimeParseError(code: LaterTimeParseErrorCode, value?: string): string {
  switch (code) {
    case "missing_message":
      return "message must be provided separately from timeText";
    case "too_soon":
      return "scheduled task time must be at least 10 seconds in the future";
    case "out_of_range":
      return "scheduled task time must be within 7 days";
    case "past_today_time":
      return `today at ${value} has already passed; choose a future time or use tomorrow`;
    case "unrecognized_time":
    case "missing_time":
    default:
      return "unrecognized timeText; supported examples: in 2h, 30\u5206\u949f\u540e, tomorrow 09:00, \u5468\u4e94 09:00";
  }
}
