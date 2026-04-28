import type { OrchestrationGroupRecord, OrchestrationTaskRecord } from "./orchestration-types";
import { renderDelegateGroupResultBlocks } from "./render-delegate-group-result";
import { renderDelegateQuestionPackage } from "./render-delegate-question-package";
import { renderDelegateResultBlocks } from "./render-delegate-result";

interface ActiveHumanQuestionPackageView {
  packageId: string;
  promptText: string;
  awaitingReplyMessageId?: string;
  deliveredChatKey?: string;
  deliveryAccountId?: string;
  routeReplyContextToken?: string;
  deliveredAt?: string;
  openTaskIds: string[];
  messageTaskQuestions?: Array<{
    taskId: string;
    questionId: string;
  }>;
  openTaskQuestions?: Array<{
    taskId: string;
    questionId: string;
    question: string;
    whyBlocked: string;
    whatIsNeeded: string;
  }>;
  queuedCount: number;
}

function renderTaskQuestionScope(
  title: string,
  taskQuestions: Array<{
    taskId: string;
    questionId: string;
    question?: string;
    whyBlocked?: string;
    whatIsNeeded?: string;
  }>,
): string {
  const lines = [title];
  if (taskQuestions.length === 0) {
    lines.push("- none");
    return lines.join("\n");
  }

  for (const task of taskQuestions) {
    lines.push(`- task_id: ${task.taskId}`);
    lines.push(`  question_id: ${task.questionId}`);
    if (task.question) {
      lines.push(`  question: ${task.question}`);
    }
    if (task.whyBlocked) {
      lines.push(`  why_blocked: ${task.whyBlocked}`);
    }
    if (task.whatIsNeeded) {
      lines.push(`  what_is_needed: ${task.whatIsNeeded}`);
    }
  }
  return lines.join("\n");
}

export function shouldBindHumanReply(input: {
  chatKey?: string;
  accountId?: string;
  replyContextToken?: string;
  activePackage?: {
    awaitingReplyMessageId?: string;
    deliveredChatKey?: string;
    deliveryAccountId?: string;
    routeReplyContextToken?: string;
    messageTaskQuestions?: Array<{ taskId: string; questionId: string }>;
  } | null;
}): boolean {
  return (
    Boolean(input.chatKey) &&
    Boolean(input.activePackage?.awaitingReplyMessageId) &&
    input.activePackage?.deliveredChatKey === input.chatKey &&
    (input.activePackage?.deliveryAccountId === undefined ||
      input.activePackage.deliveryAccountId === input.accountId) &&
    (input.activePackage?.routeReplyContextToken === undefined ||
      input.activePackage.routeReplyContextToken === input.replyContextToken) &&
    (input.activePackage?.messageTaskQuestions?.length ?? 0) > 0
  );
}

export async function buildCoordinatorPrompt(input: {
  orchestration: {
    listPendingCoordinatorGroups?: (coordinatorSession: string) => Promise<OrchestrationGroupRecord[]>;
    listPendingCoordinatorResults: (coordinatorSession: string) => Promise<OrchestrationTaskRecord[]>;
    listPendingCoordinatorBlockers?: (coordinatorSession: string) => Promise<OrchestrationTaskRecord[]>;
    listContestedCoordinatorResults?: (coordinatorSession: string) => Promise<OrchestrationTaskRecord[]>;
    getActiveHumanQuestionPackage?: (
      coordinatorSession: string,
    ) => Promise<ActiveHumanQuestionPackageView | null>;
  };
  coordinatorSession: string;
  chatKey?: string;
  accountId?: string;
  replyContextToken?: string;
  userText?: string;
  maxPromptLength?: number;
}): Promise<{
  promptText: string;
  taskIds: string[];
  groupIds: string[];
  claimHumanReply?: {
    coordinatorSession: string;
    chatKey: string;
    packageId: string;
    messageId: string;
    accountId?: string;
    replyContextToken?: string;
  };
}> {
  const pendingGroups = (await input.orchestration.listPendingCoordinatorGroups?.(input.coordinatorSession)) ?? [];
  const pendingResults = await input.orchestration.listPendingCoordinatorResults(input.coordinatorSession);
  const blockedTasks = (await input.orchestration.listPendingCoordinatorBlockers?.(input.coordinatorSession)) ?? [];
  const contestedReviews =
    (await input.orchestration.listContestedCoordinatorResults?.(input.coordinatorSession)) ?? [];
  const activePackage = await input.orchestration.getActiveHumanQuestionPackage?.(input.coordinatorSession);
  const messageSnapshotQuestions = activePackage?.messageTaskQuestions ?? [];
  const messageSnapshotKeys = new Set(
    messageSnapshotQuestions.map((task) => `${task.taskId}:${task.questionId}`),
  );
  const reopenedOutsideSnapshot =
    activePackage?.openTaskQuestions?.filter((task) => !messageSnapshotKeys.has(`${task.taskId}:${task.questionId}`)) ?? [];
  const shouldBind = shouldBindHumanReply({
    chatKey: input.chatKey,
    accountId: input.accountId,
    replyContextToken: input.replyContextToken,
    activePackage: activePackage
      ? {
          awaitingReplyMessageId: activePackage.awaitingReplyMessageId,
          deliveredChatKey: activePackage.deliveredChatKey,
          deliveryAccountId: activePackage.deliveryAccountId,
          routeReplyContextToken: activePackage.routeReplyContextToken,
          messageTaskQuestions: activePackage.messageTaskQuestions,
        }
      : null,
  });
  const packageOpenTaskIds = activePackage ? new Set(activePackage.openTaskIds) : null;
  const blockerPackageTasks = shouldBind && packageOpenTaskIds
    ? blockedTasks.filter((task) => packageOpenTaskIds.has(task.taskId))
    : blockedTasks;
  const blockerPackageContestedReviews = shouldBind && packageOpenTaskIds
    ? contestedReviews.filter((review) => packageOpenTaskIds.has(review.taskId))
    : contestedReviews;

  const tasksByGroup = new Map<string, OrchestrationTaskRecord[]>();
  for (const task of pendingResults) {
    if (!task.groupId) {
      continue;
    }
    const groupTasks = tasksByGroup.get(task.groupId) ?? [];
    groupTasks.push(task);
    tasksByGroup.set(task.groupId, groupTasks);
  }

  const readyGroups = pendingGroups
    .map((group) => ({ group, tasks: tasksByGroup.get(group.groupId) ?? [] }))
    .filter(({ tasks }) => tasks.length > 0);
  const groupedTaskIds = new Set(readyGroups.flatMap(({ tasks }) => tasks.map((task) => task.taskId)));
  const standaloneResults = pendingResults.filter((task) => !groupedTaskIds.has(task.taskId));

  const sections: string[] = [];
  if (readyGroups.length > 0 || standaloneResults.length > 0) {
    const blocks: string[] = [];
    if (readyGroups.length > 0) {
      blocks.push(renderDelegateGroupResultBlocks(readyGroups));
    }
    if (standaloneResults.length > 0) {
      blocks.push(renderDelegateResultBlocks(standaloneResults));
    }
    sections.push(
      ["以下是自上次以来完成的委派任务结果，请先吸收这些结果再回答用户问题。", blocks.join("\n\n")]
        .filter(Boolean)
        .join("\n\n"),
    );
  }

  if (blockerPackageTasks.length > 0 || blockerPackageContestedReviews.length > 0) {
    sections.push(
      renderDelegateQuestionPackage({
        coordinatorSession: input.coordinatorSession,
        blockedTasks: blockerPackageTasks.flatMap((task) => {
          if (!task.openQuestion) {
            return [];
          }
          return [
            {
              taskId: task.taskId,
              workerSession: task.workerSession,
              targetAgent: task.targetAgent,
              question: task.openQuestion.question,
              whyBlocked: task.openQuestion.whyBlocked,
              whatIsNeeded: task.openQuestion.whatIsNeeded,
            },
          ];
        }),
        contestedReviews: blockerPackageContestedReviews.flatMap((task) => {
          if (!task.reviewPending) {
            return [];
          }
          return [
            {
              taskId: task.taskId,
              reviewId: task.reviewPending.reviewId,
              resultId: task.reviewPending.resultId,
              resultText: task.reviewPending.resultText,
            },
          ];
        }),
      }),
    );
  }

  if (shouldBind && activePackage) {
    sections.push(
      [
        "当前存在一个等待 human 回复的问题包，请先判断这条回复解决了哪些 task。",
        activePackage.promptText,
        renderTaskQuestionScope("message_snapshot_tasks:", messageSnapshotQuestions),
        ...(reopenedOutsideSnapshot.length > 0
          ? [
              renderTaskQuestionScope(
                "reopened_tasks_outside_snapshot: 以下 task 不属于当前待解释消息，只能作为后续 follow-up 参考，不要用本次 human 回复直接解决。",
                reopenedOutsideSnapshot,
              ),
            ]
          : []),
      ].join("\n"),
    );
  } else if (activePackage?.awaitingReplyMessageId && messageSnapshotQuestions.length > 0) {
    sections.push(
      [
        "当前仍有一个 active human package 等待回复。",
        activePackage.promptText,
        ...(reopenedOutsideSnapshot.length > 0
          ? [renderTaskQuestionScope("reopened_tasks_outside_snapshot:", reopenedOutsideSnapshot)]
          : []),
      ].join("\n"),
    );
  } else if (activePackage && !activePackage.deliveredAt) {
    sections.push(
      [
        "当前问题包尚未成功送达 human，请先按普通主线对话处理，并提醒该问题包仍待送达或继续。",
        activePackage.promptText,
        ...(reopenedOutsideSnapshot.length > 0
          ? [renderTaskQuestionScope("reopened_tasks_outside_snapshot:", reopenedOutsideSnapshot)]
          : []),
      ].join("\n"),
    );
  } else if (activePackage && (activePackage.openTaskQuestions?.length ?? 0) > 0) {
    sections.push(
      [
        "当前 active human package 仍未收口，请先继续 follow-up，不要新开问题包。",
        renderTaskQuestionScope("unresolved_tasks:", activePackage.openTaskQuestions ?? []),
        ["最近一次发给 human 的问题包：", activePackage.promptText].join("\n"),
      ].join("\n\n"),
    );
  }

  if (input.userText) {
    sections.push(["用户最新消息：", input.userText].join("\n"));
  }

  const claimHumanReply =
    shouldBind && input.chatKey && activePackage?.awaitingReplyMessageId
      ? {
          coordinatorSession: input.coordinatorSession,
          chatKey: input.chatKey,
          packageId: activePackage.packageId,
          messageId: activePackage.awaitingReplyMessageId,
          ...(input.accountId ? { accountId: input.accountId } : {}),
          ...(input.replyContextToken ? { replyContextToken: input.replyContextToken } : {}),
        }
      : undefined;

  let promptText = sections.length > 0 ? sections.join("\n\n") : (input.userText ?? "");

  if (input.maxPromptLength && promptText.length > input.maxPromptLength) {
    promptText = promptText.slice(0, input.maxPromptLength - 3) + "...";
  }

  return {
    promptText,
    taskIds: [...groupedTaskIds, ...standaloneResults.map((task) => task.taskId)],
    groupIds: readyGroups.map(({ group }) => group.groupId),
    ...(claimHumanReply ? { claimHumanReply } : {}),
  };
}
