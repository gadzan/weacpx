import type { AppLogger } from "../logging/app-logger";
import type { ScheduledChannelMessageInput } from "../channels/types";
import type { ResolvedSession } from "../transport/types";
import { toDisplaySessionAlias } from "../channels/channel-scope";
import { preview } from "./scheduled-render";
import type { ScheduledTaskRecord } from "./scheduled-types";

export interface ScheduledDispatchDeps {
  getSession: (alias: string) => Promise<ResolvedSession | null>;
  resolveSession: (
    alias: string,
    agent: string,
    workspace: string,
    transportSession: string,
  ) => ResolvedSession;
  sendScheduledMessage: (input: ScheduledChannelMessageInput) => Promise<void>;
  removeSession?: (session: ResolvedSession) => Promise<void>;
  logger?: AppLogger;
}

export function buildScheduledDispatchTask(deps: ScheduledDispatchDeps) {
  return async (task: ScheduledTaskRecord, abortSignal: AbortSignal): Promise<void> => {
    if (task.session_mode === "temp") {
      await dispatchTemp(task, abortSignal, deps);
      return;
    }
    await dispatchBound(task, abortSignal, deps);
  };
}

async function dispatchBound(
  task: ScheduledTaskRecord,
  abortSignal: AbortSignal,
  deps: ScheduledDispatchDeps,
): Promise<void> {
  const session = await deps.getSession(task.session_alias);
  if (!session) {
    throw new Error(`session "${task.session_alias}" not found for scheduled task`);
  }
  const noticeText = `执行定时任务 #${task.id}\n会话：${toDisplaySessionAlias(task.session_alias)}\n内容：${preview(task.message)}`;
  await deps.sendScheduledMessage({
    chatKey: task.chat_key,
    taskId: task.id,
    sessionAlias: task.session_alias,
    noticeText,
    promptText: task.message,
    abortSignal,
    ...(task.account_id ? { accountId: task.account_id } : {}),
    ...(task.reply_context_token ? { replyContextToken: task.reply_context_token } : {}),
  });
}

async function dispatchTemp(
  task: ScheduledTaskRecord,
  abortSignal: AbortSignal,
  deps: ScheduledDispatchDeps,
): Promise<void> {
  if (!task.agent || !task.workspace) {
    throw new Error(`temp scheduled task #${task.id} is missing its agent/workspace snapshot`);
  }
  const alias = `later-${task.id}`;
  const transportSession = `${task.workspace}:${alias}`;
  const session = deps.resolveSession(alias, task.agent, task.workspace, transportSession);
  const noticeText = `执行定时任务 #${task.id}\n会话：临时会话（${task.workspace} · ${task.agent}）\n内容：${preview(task.message)}`;

  try {
    await deps.sendScheduledMessage({
      chatKey: task.chat_key,
      taskId: task.id,
      sessionAlias: task.session_alias,
      sessionDescriptor: { alias, agent: task.agent, workspace: task.workspace, transportSession },
      noticeText,
      promptText: task.message,
      abortSignal,
      ...(task.account_id ? { accountId: task.account_id } : {}),
      ...(task.reply_context_token ? { replyContextToken: task.reply_context_token } : {}),
    });
  } finally {
    if (deps.removeSession) {
      try {
        await deps.removeSession(session);
      } catch (error) {
        await deps.logger?.error(
          "scheduled.temp_session_close_failed",
          "failed to close temp scheduled session",
          { taskId: task.id, transportSession, error: String(error) },
        );
      }
    }
  }
}
