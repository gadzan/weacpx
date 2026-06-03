import type { OrchestrationMessages } from "../../types";

export const orchestration: OrchestrationMessages = {
  // handler guard — no current session
  noCurrentSession: "当前还没有选中的会话。请先执行 /session new ... 或 /use <alias>。",

  // handler guard — orchestration service not enabled
  serviceUnavailable: "当前未启用任务编排服务。",

  // handler — task/group not found
  taskNotFound: "没有找到对应任务。",
  groupNotFound: "没有找到对应任务组。",

  // render-text: renderDelegateSuccess
  delegateSuccessCreated: (taskId) => `已创建委派任务「${taskId}」`,
  delegateSuccessWorker: (workerSession) => `worker 会话：${workerSession}`,

  // render-text: renderGroupCreated
  groupCreatedId: (groupId) => `已创建任务组「${groupId}」`,
  groupCreatedTitle: (title) => `- 标题：${title}`,

  // render-text: renderGroupList
  groupListEmpty: "当前协调会话下还没有任务组。",
  groupListHeader: "当前协调会话的任务组：",

  // render-text: renderGroupSummary
  groupSummaryId: (groupId) => `任务组「${groupId}」`,
  groupSummaryTitle: (title) => `- 标题：${title}`,
  groupSummaryCoordinator: (coordinatorSession) => `- 协调会话：${coordinatorSession}`,
  groupSummaryTotal: (count) => `- 总任务数：${count}`,
  groupSummaryPending: (count) => `- 待确认：${count}`,
  groupSummaryRunning: (count) => `- 运行中：${count}`,
  groupSummaryCompleted: (count) => `- 已完成：${count}`,
  groupSummaryFailed: (count) => `- 已失败：${count}`,
  groupSummaryCancelled: (count) => `- 已取消：${count}`,
  groupSummaryTerminal: (isTerminal) => `- 是否终态：${isTerminal ? "是" : "否"}`,
  groupSummaryTerminalYes: "是",
  groupSummaryTerminalNo: "否",
  groupSummaryInjectionPending: (pending) => `- 注入待处理：${pending ? "是" : "否"}`,
  groupSummaryInjectionAppliedAt: (time) => `- 注入完成时间：${time}`,
  groupSummaryLastInjectionError: (error) => `- 最近注入错误：${error}`,
  groupSummaryMembersHeader: "- 成员：",

  // render-text: renderGroupCancelSuccess
  groupCancelSuccessId: (groupId) => `任务组「${groupId}」已发起取消`,
  groupCancelSuccessCancelledCount: (count) => `- 已请求取消：${count}`,
  groupCancelSuccessSkippedCount: (count) => `- 已跳过终态任务：${count}`,

  // render-text: renderTaskList
  taskListEmpty: "当前协调会话下还没有任务。",
  taskListHeader: "当前协调会话的任务：",

  // render-text: renderTaskSummary
  taskSummaryId: (taskId) => `任务「${taskId}」`,
  taskSummaryStatus: (status) => `- 状态：${status}`,
  taskSummaryCoordinator: (coordinatorSession) => `- 协调会话：${coordinatorSession}`,
  taskSummaryWorker: (workerSession) => `- worker 会话：${workerSession}`,
  taskSummaryWorkerUnassigned: "未分配",
  taskSummaryTargetAgent: (agent) => `- 目标 Agent：${agent}`,
  taskSummaryRole: (role) => `- 角色：${role}`,
  taskSummaryGroup: (groupId) => `- 任务组：${groupId}`,
  taskSummarySource: (sourceKind, sourceHandle, roleSuffix) =>
    `- 来源：${sourceKind} / ${sourceHandle}${roleSuffix}`,
  taskSummaryTask: (task) => `- 任务：${task}`,
  taskSummarySummary: (summary) => `- 摘要：${summary}`,
  taskSummaryLatestProgress: (progress) => `- 最新进展：${progress}`,
  taskSummaryResult: (result) => `- 结果：${result}`,
  taskSummaryTimelineHeader: "- 时间线：",

  // render-text: renderTaskCancelSuccess
  taskCancelAlreadyDone: (taskId) => `任务「${taskId}」已结束。`,
  taskCancelRequested: (taskId) => `已请求取消任务「${taskId}」。`,
  taskCancelled: (taskId) => `任务「${taskId}」已取消。`,
  taskCurrentStatus: (status) => `- 当前状态：${status}`,

  // render-text: renderTaskApprovalSuccess
  taskApproved: (taskId) => `已批准任务「${taskId}」。`,

  // render-text: renderTaskRejectSuccess
  taskRejected: (taskId) => `已拒绝任务「${taskId}」。`,

  // render-text: renderTaskConfirmationUnavailable
  taskConfirmationUnavailable: (taskId) => `任务「${taskId}」当前不是待确认状态。`,

  // render-text: renderTasksCleanResult
  tasksCleanEmpty: "当前协调会话下没有可清理的任务。",
  tasksCleanRemovedTasks: (count) => `已清理 ${count} 个已结束的任务。`,
  tasksCleanRemovedBindings: (count) => `已释放 ${count} 个无效的 worker 绑定。`,

  // render-text: renderTaskListItem (inline rendering)
  taskListItemGroup: (groupId) => `；组：${groupId}`,
  taskListItemSource: (sourceKind, sourceHandle, roleSuffix) =>
    `；来源：${sourceKind} / ${sourceHandle}${roleSuffix}`,
  taskListItemNoticePending: "通知待重试",
  taskListItemInjectionPending: "注入待重试",
  taskListItemCancelling: "取消中",

  // render-text: renderGroupListItem (inline rendering)
  groupListItemInjectionPending: "注入待重试",
  groupListItemTotal: (count) => `总计 ${count}`,
  groupListItemPending: (count) => `待确认 ${count}`,
  groupListItemRunning: (count) => `运行中 ${count}`,
  groupListItemCompleted: (count) => `完成 ${count}`,
  groupListItemFailed: (count) => `失败 ${count}`,
  groupListItemCancelled: (count) => `取消 ${count}`,

  // render-delegate-group-result: truncate
  truncatedResult: (taskId) => `\n... (结果已截断，完整内容请执行 /task ${taskId})`,

  // render-delegate-group-result: pickNextAction
  nextActionNoMembers: "本组没有任何成员，可忽略此聚合结果。",
  nextActionMixed: "优先分析 failures 段的失败原因，并决定是否基于 successes 结果继续推进。",
  nextActionAllFailed: "本组全部失败，请先诊断 failures 段后再决定下一步。",
  nextActionOtherOnly: "本组尚未产出结果，其余成员仍在进行或已取消。",
  nextActionMostlySuccess: "可基于 successes 段继续推进，其余成员仍在进行或已取消。",
  nextActionAllSuccess: "可基于 successes 段继续推进。",

  // orchestrationHelp metadata
  helpSummary: "委派子任务、组织任务组、查看任务状态，并处理待确认的编排请求。",
  helpCmdDg: "/dg <agent> <task>",
  helpCmdDgDesc: "把当前主线中的子任务快速委派给目标 agent",
  helpCmdDelegate: "/delegate <agent> <task>",
  helpCmdDelegateDesc: "把当前主线中的子任务委派给目标 agent",
  helpCmdDelegateRole: "/delegate <agent> --role <role> <task>",
  helpCmdDelegateRoleDesc: "按指定角色模板委派子任务",
  helpCmdDelegateGroup: "/delegate <agent> --group <groupId> <task>",
  helpCmdDelegateGroupDesc: "把委派任务附加到指定任务组",
  helpCmdGroupNew: "/group new <title>",
  helpCmdGroupNewDesc: "在当前主线下创建一个任务组",
  helpCmdGroupGet: "/group <id>",
  helpCmdGroupGetDesc: "查看单个任务组详情",
  helpCmdGroupAdd: "/group add <groupId> <agent> <task>",
  helpCmdGroupAddDesc: "把子任务加入已有任务组（等价于 /delegate --group）",
  helpCmdGroupAddRole: "/group add <groupId> <agent> --role <role> <task>",
  helpCmdGroupAddRoleDesc: "按角色模板把子任务加入已有任务组",
  helpCmdGroupCancel: "/group cancel <groupId>",
  helpCmdGroupCancelDesc: "取消指定任务组下所有未结束任务",
  helpCmdGroups: "/groups",
  helpCmdGroupsDesc: "查看当前主线下的任务组列表",
  helpCmdTasks: "/tasks",
  helpCmdTasksDesc: "查看当前主线下的任务列表",
  helpCmdTasksStatus: "/tasks --status <state>",
  helpCmdTasksStatusDesc: "按状态过滤任务（running/completed/failed/cancelled/needs_confirmation）",
  helpCmdTasksStuck: "/tasks --stuck",
  helpCmdTasksStuckDesc: "只看心跳超时的 running 任务",
  helpCmdTasksClean: "/tasks clean",
  helpCmdTasksCleanDesc: "清理当前主线下的已结束任务和无效绑定",
  helpCmdTaskGet: "/task <id>",
  helpCmdTaskGetDesc: "查看单个任务详情",
  helpCmdTaskApprove: "/task approve <id>",
  helpCmdTaskApproveDesc: "批准一个 needs_confirmation 任务并开始派发",
  helpCmdTaskReject: "/task reject <id>",
  helpCmdTaskRejectDesc: "拒绝一个 needs_confirmation 任务",
  helpCmdTaskCancel: "/task cancel <id>",
  helpCmdTaskCancelDesc: "取消当前主线下的任务",
  helpExample1: "/dg claude 审查当前方案的 3 个最高风险点",
  helpExample2: "/dg claude --group review-batch 审查接口设计",
  helpExample3: "/dg codex --role planner 把这个需求拆成最小实现步骤",
  helpExample4: "/group new parallel review",
  helpExample5: "/group add review-batch claude --role reviewer 审查接口设计",
  helpExample6: "/groups",
  helpExample7: "/group cancel review-batch",
  helpExample8: "/tasks",
  helpExample9: "/tasks clean",
  helpExample10: "/task approve task_123",
};
