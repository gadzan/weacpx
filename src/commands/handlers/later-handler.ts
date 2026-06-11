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
  // Parallel to `tokens`: tails[i] is the verbatim input from token i to the
  // end (quotes and internal spacing intact). The stored message must come
  // from here so user content is never rewritten by tokenization.
  tails: string[],
  scheduled: ScheduledRouterOps,
  chatKey: string,
  currentSession: { alias: string; agent: string; workspace: string } | null,
  defaultMode: ScheduledSessionMode,
  accountId?: string,
  replyContextToken?: string,
): Promise<RouterResponse> {
  const l = t().later;

  // Consume any leading --bind / --temp flags (mutually exclusive).
  let restStart = 0;
  const seenFlags = new Set<string>();
  let flagMode: ScheduledSessionMode | undefined;
  while (restStart < tokens.length && (tokens[restStart] === "--bind" || tokens[restStart] === "--temp")) {
    seenFlags.add(tokens[restStart] ?? "");
    flagMode = tokens[restStart] === "--bind" ? "bound" : "temp";
    restStart += 1;
  }
  const rest = tokens.slice(restStart);
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

  // Verbatim message body: take the raw tail at the first body token instead
  // of re-joining tokens (which would strip quotes and collapse spacing).
  const message = (tails[restStart + result.messageStartIndex] ?? "").trim();
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

export function handleLaterList(scheduled: ScheduledRouterOps, chatKey: string): RouterResponse {
  // Scoped to the requesting chat: another chat's tasks (and their message
  // text) must never be visible here.
  const tasks = scheduled.listPending(chatKey);
  return { text: renderLaterList(tasks, (alias) => toDisplaySessionAlias(alias)) };
}

export async function handleLaterCancel(id: string, scheduled: ScheduledRouterOps, chatKey: string): Promise<RouterResponse> {
  const ok = await scheduled.cancelPending(id, chatKey);
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
