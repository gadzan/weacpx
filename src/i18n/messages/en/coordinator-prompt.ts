import type { CoordinatorPromptMessages } from "../../types";

export const coordinatorPrompt: CoordinatorPromptMessages = {
  // build-coordinator-prompt.ts — pending results section header
  pendingResultsHeader: "The following are delegated task results completed since the last turn. Please absorb these results before answering the user's question.",

  // build-coordinator-prompt.ts — human reply binding section
  humanReplyBindingHeader: "There is currently a question package awaiting a human reply. Please first determine which tasks this reply resolves.",
  reopenedOutsideSnapshotLabel: "reopened_tasks_outside_snapshot: The following tasks are not part of the current awaited message and can only be used as follow-up reference — do not resolve them with this human reply.",

  // build-coordinator-prompt.ts — active package still awaiting reply
  activePackageAwaitingReply: "There is still an active human package awaiting a reply.",

  // build-coordinator-prompt.ts — package not yet delivered
  packageNotDelivered: "The current question package has not yet been successfully delivered to the human. Please handle this as a normal main-line conversation and remind that the question package is still pending delivery or continuation.",

  // build-coordinator-prompt.ts — active package not closed
  activePackageNotClosed: "The current active human package is still not closed. Please continue the follow-up first and do not open a new question package.",
  recentHumanPackageLabel: "Most recent question package sent to human:",

  // build-coordinator-prompt.ts — user message label
  userMessageLabel: "Latest user message:",
};
