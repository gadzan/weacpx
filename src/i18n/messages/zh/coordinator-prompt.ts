import type { CoordinatorPromptMessages } from "../../types";

export const coordinatorPrompt: CoordinatorPromptMessages = {
  // build-coordinator-prompt.ts — pending results section header
  pendingResultsHeader: "以下是自上次以来完成的委派任务结果，请先吸收这些结果再回答用户问题。",

  // build-coordinator-prompt.ts — human reply binding section
  humanReplyBindingHeader: "当前存在一个等待 human 回复的问题包，请先判断这条回复解决了哪些 task。",
  reopenedOutsideSnapshotLabel: "reopened_tasks_outside_snapshot: 以下 task 不属于当前待解释消息，只能作为后续 follow-up 参考，不要用本次 human 回复直接解决。",

  // build-coordinator-prompt.ts — active package still awaiting reply
  activePackageAwaitingReply: "当前仍有一个 active human package 等待回复。",

  // build-coordinator-prompt.ts — package not yet delivered
  packageNotDelivered: "当前问题包尚未成功送达 human，请先按普通主线对话处理，并提醒该问题包仍待送达或继续。",

  // build-coordinator-prompt.ts — active package not closed
  activePackageNotClosed: "当前 active human package 仍未收口，请先继续 follow-up，不要新开问题包。",
  recentHumanPackageLabel: "最近一次发给 human 的问题包：",

  // build-coordinator-prompt.ts — user message label
  userMessageLabel: "用户最新消息：",
};
