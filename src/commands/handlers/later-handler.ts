import type { RouterResponse, ScheduledRouterOps } from "../router-types";
import type { ScheduledTaskRecord, ScheduledSessionMode } from "../../scheduled/scheduled-types";
import { parseLaterTime } from "../../scheduled/parse-later-time";
import { renderLaterHelp, renderLaterList, renderTaskCreated } from "../../scheduled/scheduled-render";
import { toDisplaySessionAlias } from "../../channels/channel-scope";
import type { HelpTopicMetadata } from "../help/help-types";
import { t } from "../../i18n";

export function laterHelp(): HelpTopicMetadata {
  const l = t().later;
  return {
    topic: "later",
    aliases: ["lt"],
    summary: l.helpSummary,
    commands: [
      { usage: l.helpCmdCreate, description: l.helpCmdCreateDesc },
      { usage: l.helpCmdBind, description: l.helpCmdBindDesc },
      { usage: l.helpCmdTemp, description: l.helpCmdTempDesc },
      { usage: l.helpCmdList, description: l.helpCmdListDesc },
      { usage: l.helpCmdCancel, description: l.helpCmdCancelDesc },
    ],
    examples: [
      l.helpExample1,
      l.helpExample2,
      l.helpExample3,
      l.helpExample4,
      l.helpExample5,
    ],
    notes: [
      l.helpNote1,
      l.helpNote2,
      l.helpNote3,
      l.helpNote4,
      l.helpNote5,
      l.helpNote6,
      l.helpNote7,
    ],
  };
}

export function handleLaterHelp(): RouterResponse {
  return { text: renderLaterHelp() };
}

export async function handleLaterCreate(
  tokens: string[],
  scheduled: ScheduledRouterOps,
  chatKey: string,
  currentSession: { alias: string; agent: string; workspace: string } | null,
  defaultMode: ScheduledSessionMode,
  accountId?: string,
  replyContextToken?: string,
): Promise<RouterResponse> {
  const l = t().later;

  // Consume any leading --bind / --temp flags (mutually exclusive).
  let rest = tokens;
  const seenFlags = new Set<string>();
  let flagMode: ScheduledSessionMode | undefined;
  while (rest.length > 0 && (rest[0] === "--bind" || rest[0] === "--temp")) {
    seenFlags.add(rest[0]);
    flagMode = rest[0] === "--bind" ? "bound" : "temp";
    rest = rest.slice(1);
  }
  if (seenFlags.size > 1) {
    return { text: l.bindAndTempMutuallyExclusive };
  }
  const mode: ScheduledSessionMode = flagMode ?? defaultMode;

  if (!currentSession) {
    return {
      text: [
        l.noSession,
        "",
        l.noSessionHint,
        l.noSessionExampleNew,
        l.noSessionExampleUse,
      ].join("\n"),
    };
  }

  const result = parseLaterTime(rest);
  if (!result.ok) {
    return { text: renderTimeParseError(result.code, result.value) };
  }

  const message = rest.slice(result.messageStartIndex).join(" ").trim();
  if (message.startsWith("/")) {
    return {
      text: [
        l.slashMessageRejected,
        "",
        l.slashMessageHint,
        l.slashMessageExample,
      ].join("\n"),
    };
  }

  const task = await scheduled.createTask({
    chatKey,
    sessionAlias: currentSession.alias,
    executeAt: result.executeAt,
    message,
    sessionMode: mode,
    ...(mode === "temp" ? { agent: currentSession.agent, workspace: currentSession.workspace } : {}),
    ...(accountId ? { accountId } : {}),
    ...(replyContextToken ? { replyContextToken } : {}),
  });
  return { text: renderTaskCreated(task, toDisplaySessionAlias(currentSession.alias)) };
}

export function handleLaterList(scheduled: ScheduledRouterOps): RouterResponse {
  const tasks = scheduled.listPending();
  return { text: renderLaterList(tasks, (alias) => toDisplaySessionAlias(alias)) };
}

export async function handleLaterCancel(id: string, scheduled: ScheduledRouterOps): Promise<RouterResponse> {
  const ok = await scheduled.cancelPending(id);
  const displayId = id.replace(/^#/, "").toLowerCase();
  if (ok) {
    return { text: t().later.cancelSuccess(displayId) };
  }
  return { text: [t().later.cancelNotFound(displayId), t().later.cancelNotFoundHint].join("\n") };
}

function renderTimeParseError(code: string, value?: string): string {
  const l = t().later;
  switch (code) {
    case "missing_message":
      return l.missingMessage;
    case "too_soon":
      return l.tooSoon;
    case "out_of_range":
      return l.outOfRange;
    case "past_today_time":
      return l.pastTodayTime(value ?? "");
    case "unrecognized_time":
    case "missing_time":
    default:
      return [
        l.unrecognizedTime,
        "",
        l.unrecognizedTimeFormats,
        l.unrecognizedTimeExample1,
        l.unrecognizedTimeExample2,
        l.unrecognizedTimeExample3,
        l.unrecognizedTimeExample4,
      ].join("\n");
  }
}
