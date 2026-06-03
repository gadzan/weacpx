import type { OrchestrationMessages } from "../../types";

export const orchestration: OrchestrationMessages = {
  // handler guard — no current session
  noCurrentSession: "No session is currently selected. Run /session new ... or /use <alias> first.",

  // handler guard — orchestration service not enabled
  serviceUnavailable: "Orchestration service is not enabled.",

  // handler — task/group not found
  taskNotFound: "No matching task found.",
  groupNotFound: "No matching task group found.",

  // render-text: renderDelegateSuccess
  delegateSuccessCreated: (taskId) => `Delegated task "${taskId}" created.`,
  delegateSuccessWorker: (workerSession) => `Worker session: ${workerSession}`,

  // render-text: renderGroupCreated
  groupCreatedId: (groupId) => `Task group "${groupId}" created.`,
  groupCreatedTitle: (title) => `- Title: ${title}`,

  // render-text: renderGroupList
  groupListEmpty: "No task groups under the current coordinator session.",
  groupListHeader: "Task groups for the current coordinator session:",

  // render-text: renderGroupSummary
  groupSummaryId: (groupId) => `Task group "${groupId}"`,
  groupSummaryTitle: (title) => `- Title: ${title}`,
  groupSummaryCoordinator: (coordinatorSession) => `- Coordinator session: ${coordinatorSession}`,
  groupSummaryTotal: (count) => `- Total tasks: ${count}`,
  groupSummaryPending: (count) => `- Pending approval: ${count}`,
  groupSummaryRunning: (count) => `- Running: ${count}`,
  groupSummaryCompleted: (count) => `- Completed: ${count}`,
  groupSummaryFailed: (count) => `- Failed: ${count}`,
  groupSummaryCancelled: (count) => `- Cancelled: ${count}`,
  groupSummaryTerminal: (isTerminal) => `- Terminal: ${isTerminal ? "yes" : "no"}`,
  groupSummaryTerminalYes: "yes",
  groupSummaryTerminalNo: "no",
  groupSummaryInjectionPending: (pending) => `- Injection pending: ${pending ? "yes" : "no"}`,
  groupSummaryInjectionAppliedAt: (time) => `- Injection applied at: ${time}`,
  groupSummaryLastInjectionError: (error) => `- Last injection error: ${error}`,
  groupSummaryMembersHeader: "- Members:",

  // render-text: renderGroupCancelSuccess
  groupCancelSuccessId: (groupId) => `Cancellation requested for task group "${groupId}".`,
  groupCancelSuccessCancelledCount: (count) => `- Cancellation requested: ${count}`,
  groupCancelSuccessSkippedCount: (count) => `- Skipped (already terminal): ${count}`,

  // render-text: renderTaskList
  taskListEmpty: "No tasks under the current coordinator session.",
  taskListHeader: "Tasks for the current coordinator session:",

  // render-text: renderTaskSummary
  taskSummaryId: (taskId) => `Task "${taskId}"`,
  taskSummaryStatus: (status) => `- Status: ${status}`,
  taskSummaryCoordinator: (coordinatorSession) => `- Coordinator session: ${coordinatorSession}`,
  taskSummaryWorker: (workerSession) => `- Worker session: ${workerSession}`,
  taskSummaryWorkerUnassigned: "unassigned",
  taskSummaryTargetAgent: (agent) => `- Target agent: ${agent}`,
  taskSummaryRole: (role) => `- Role: ${role}`,
  taskSummaryGroup: (groupId) => `- Group: ${groupId}`,
  taskSummarySource: (sourceKind, sourceHandle, roleSuffix) =>
    `- Source: ${sourceKind} / ${sourceHandle}${roleSuffix}`,
  taskSummaryTask: (task) => `- Task: ${task}`,
  taskSummarySummary: (summary) => `- Summary: ${summary}`,
  taskSummaryLatestProgress: (progress) => `- Latest progress: ${progress}`,
  taskSummaryResult: (result) => `- Result: ${result}`,
  taskSummaryTimelineHeader: "- Timeline:",

  // render-text: renderTaskCancelSuccess
  taskCancelAlreadyDone: (taskId) => `Task "${taskId}" has already finished.`,
  taskCancelRequested: (taskId) => `Cancellation requested for task "${taskId}".`,
  taskCancelled: (taskId) => `Task "${taskId}" cancelled.`,
  taskCurrentStatus: (status) => `- Current status: ${status}`,

  // render-text: renderTaskApprovalSuccess
  taskApproved: (taskId) => `Task "${taskId}" approved.`,

  // render-text: renderTaskRejectSuccess
  taskRejected: (taskId) => `Task "${taskId}" rejected.`,

  // render-text: renderTaskConfirmationUnavailable
  taskConfirmationUnavailable: (taskId) => `Task "${taskId}" is not in needs_confirmation state.`,

  // render-text: renderTasksCleanResult
  tasksCleanEmpty: "No tasks to clean under the current coordinator session.",
  tasksCleanRemovedTasks: (count) => `Cleaned ${count} finished task(s).`,
  tasksCleanRemovedBindings: (count) => `Released ${count} stale worker binding(s).`,

  // render-text: renderTaskListItem (inline rendering)
  taskListItemGroup: (groupId) => `; group: ${groupId}`,
  taskListItemSource: (sourceKind, sourceHandle, roleSuffix) =>
    `; source: ${sourceKind} / ${sourceHandle}${roleSuffix}`,
  taskListItemNoticePending: "notice retry pending",
  taskListItemInjectionPending: "injection retry pending",
  taskListItemCancelling: "cancelling",

  // render-text: renderGroupListItem (inline rendering)
  groupListItemInjectionPending: "injection retry pending",
  groupListItemTotal: (count) => `total ${count}`,
  groupListItemPending: (count) => `pending ${count}`,
  groupListItemRunning: (count) => `running ${count}`,
  groupListItemCompleted: (count) => `completed ${count}`,
  groupListItemFailed: (count) => `failed ${count}`,
  groupListItemCancelled: (count) => `cancelled ${count}`,

  // render-delegate-group-result: truncate
  truncatedResult: (taskId) => `\n... (result truncated — run /task ${taskId} for the full output)`,

  // render-delegate-group-result: pickNextAction
  nextActionNoMembers: "This group has no members; the aggregate result can be ignored.",
  nextActionMixed:
    "Prioritise analysing the failures section, then decide whether to continue based on the successes.",
  nextActionAllFailed:
    "All tasks failed. Diagnose the failures section before deciding on next steps.",
  nextActionOtherOnly:
    "No results yet — remaining members are still running or have been cancelled.",
  nextActionMostlySuccess:
    "You can proceed based on the successes section; other members are still running or cancelled.",
  nextActionAllSuccess: "You can proceed based on the successes section.",

  // orchestrationHelp metadata
  helpSummary:
    "Delegate subtasks, organise task groups, view task status, and handle pending orchestration confirmations.",
  helpCmdDg: "/dg <agent> <task>",
  helpCmdDgDesc: "Quickly delegate a subtask in the current mainline to the target agent",
  helpCmdDelegate: "/delegate <agent> <task>",
  helpCmdDelegateDesc: "Delegate a subtask in the current mainline to the target agent",
  helpCmdDelegateRole: "/delegate <agent> --role <role> <task>",
  helpCmdDelegateRoleDesc: "Delegate a subtask using the specified role template",
  helpCmdDelegateGroup: "/delegate <agent> --group <groupId> <task>",
  helpCmdDelegateGroupDesc: "Attach a delegated task to the specified task group",
  helpCmdGroupNew: "/group new <title>",
  helpCmdGroupNewDesc: "Create a task group under the current mainline",
  helpCmdGroupGet: "/group <id>",
  helpCmdGroupGetDesc: "View the details of a single task group",
  helpCmdGroupAdd: "/group add <groupId> <agent> <task>",
  helpCmdGroupAddDesc: "Add a subtask to an existing task group (equivalent to /delegate --group)",
  helpCmdGroupAddRole: "/group add <groupId> <agent> --role <role> <task>",
  helpCmdGroupAddRoleDesc: "Add a subtask to an existing task group using a role template",
  helpCmdGroupCancel: "/group cancel <groupId>",
  helpCmdGroupCancelDesc: "Cancel all unfinished tasks in the specified task group",
  helpCmdGroups: "/groups",
  helpCmdGroupsDesc: "List task groups under the current mainline",
  helpCmdTasks: "/tasks",
  helpCmdTasksDesc: "List tasks under the current mainline",
  helpCmdTasksStatus: "/tasks --status <state>",
  helpCmdTasksStatusDesc:
    "Filter tasks by status (running/completed/failed/cancelled/needs_confirmation)",
  helpCmdTasksStuck: "/tasks --stuck",
  helpCmdTasksStuckDesc: "Show only running tasks with a stale heartbeat",
  helpCmdTasksClean: "/tasks clean",
  helpCmdTasksCleanDesc: "Clean up finished tasks and stale bindings under the current mainline",
  helpCmdTaskGet: "/task <id>",
  helpCmdTaskGetDesc: "View the details of a single task",
  helpCmdTaskApprove: "/task approve <id>",
  helpCmdTaskApproveDesc: "Approve a needs_confirmation task and start dispatching it",
  helpCmdTaskReject: "/task reject <id>",
  helpCmdTaskRejectDesc: "Reject a needs_confirmation task",
  helpCmdTaskCancel: "/task cancel <id>",
  helpCmdTaskCancelDesc: "Cancel a task under the current mainline",
  helpExample1: "/dg claude Review the 3 highest-risk points in the current plan",
  helpExample2: "/dg claude --group review-batch Review the API design",
  helpExample3: "/dg codex --role planner Break this requirement into the smallest implementation steps",
  helpExample4: "/group new parallel review",
  helpExample5: "/group add review-batch claude --role reviewer Review the API design",
  helpExample6: "/groups",
  helpExample7: "/group cancel review-batch",
  helpExample8: "/tasks",
  helpExample9: "/tasks clean",
  helpExample10: "/task approve task_123",
};
