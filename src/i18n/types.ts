export interface CommonMessages {
  localeName: string;
}

export interface SessionMessages {
  // Shared / guard
  noCurrent: string;

  // handleSessions
  noSessions: string;
  crossChannelHint: string;
  createSessionHint: string;
  createSessionExample: string;
  sessionListHeader: string;
  currentLabel: string;
  sessionListItem: (alias: string, agent: string, workspace: string) => string;

  // handleSessionNew / handleSessionAttach
  sessionCreated: (alias: string) => string;
  sessionAttachNotFound: (alias: string, agent: string, workspace: string) => string;
  sessionAttached: (alias: string) => string;

  // renderSwitched / appendSwitchBackContext
  switched: (alias: string, agent: string, workspace: string) => string;
  switchedWithPrev: (alias: string, agent: string, workspace: string, previousAlias: string) => string;
  stillRunning: (alias: string) => string;

  // handleSessionUse / handleSessionUsePrevious / handleCancel
  noMatchingSession: (input: string) => string;
  ambiguousSession: (input: string) => string;
  noPreviousSession: string;

  // handleModeShow / handleModeSet
  modeHeader: string;
  modeSessionLabel: (alias: string) => string;
  modeModeLabel: (modeId: string) => string;
  modeNotSet: string;
  modeSet: (modeId: string) => string;

  // handleReplyModeShow / handleReplyModeSet / handleReplyModeReset
  replyModeHeader: string;
  replyModeSessionLabel: (alias: string) => string;
  replyModeGlobalDefault: (value: string) => string;
  replyModeSessionOverride: (value: string) => string;
  replyModeEffective: (value: string) => string;
  replyModeSet: (replyMode: string) => string;
  replyModeReset: (globalDefault: string) => string;

  // handleStatus
  statusHeader: string;
  statusNameLabel: (alias: string) => string;
  statusAgentLabel: (agent: string) => string;
  statusWorkspaceLabel: (workspace: string) => string;

  // promptWithSession — orchestration route error
  orchestrationRouteError: string;
  orchestrationRouteRetry: string;

  // handleSessionRemove
  sessionNotFound: (alias: string) => string;
  sessionBlockedByTasks: (alias: string, count: number) => string;
  sessionBlockedByTasksHint: string;
  sessionRemoved: (alias: string) => string;
  sessionRemovedWasActive: string;
  sessionTransportShared: (transportSession: string, count: number) => string;
  sessionOrchestrationPurgeFailed: (warning: string) => string;
  sessionTransportTeardownFailed: (warning: string) => string;

  // sessionHelp metadata
  sessionHelpSummary: string;
  sessionHelpCmdSsList: string;
  sessionHelpCmdSsListDesc: string;
  sessionHelpCmdSsOrSlash: string;
  sessionHelpCmdSsOrSlashDesc: string;
  sessionHelpCmdSsQuick: string;
  sessionHelpCmdSsQuickDesc: string;
  sessionHelpCmdSsNew: string;
  sessionHelpCmdSsNewDesc: string;
  sessionHelpCmdSsNewAlias: string;
  sessionHelpCmdSsNewAliasDesc: string;
  sessionHelpCmdSsAttach: string;
  sessionHelpCmdSsAttachDesc: string;
  sessionHelpCmdSsn: string;
  sessionHelpCmdSsnDesc: string;
  sessionHelpCmdTail: string;
  sessionHelpCmdTailDesc: string;
  sessionHelpCmdRm: string;
  sessionHelpCmdRmDesc: string;
  sessionHelpCmdUse: string;
  sessionHelpCmdUseDesc: string;
  sessionHelpCmdUseFuzzy: string;
  sessionHelpCmdUseFuzzyDesc: string;
  sessionHelpCmdUsePrev: string;
  sessionHelpCmdUsePrevDesc: string;
  sessionHelpCmdReset: string;
  sessionHelpCmdResetDesc: string;

  // nativeSessionHelp metadata
  nativeHelpSummary: string;
  nativeHelpCmdSsn: string;
  nativeHelpCmdSsnDesc: string;
  nativeHelpCmdSsnAgentWs: string;
  nativeHelpCmdSsnAgentWsDesc: string;
  nativeHelpCmdSsnAgentDir: string;
  nativeHelpCmdSsnAgentDirDesc: string;
  nativeHelpCmdSsnAgentAll: string;
  nativeHelpCmdSsnAgentAllDesc: string;
  nativeHelpCmdSsnNumber: string;
  nativeHelpCmdSsnNumberDesc: string;
  nativeHelpCmdSsnNumberAlias: string;
  nativeHelpCmdSsnNumberAliasDesc: string;
  nativeHelpCmdSsnAttach: string;
  nativeHelpCmdSsnAttachDesc: string;
  nativeHelpCmdSsnAttachLong: string;
  nativeHelpCmdSsnAttachLongDesc: string;
  nativeHelpNote1: string;
  nativeHelpNote2: string;
  nativeHelpNote3: string;
  nativeHelpNote4: string;

  // modeHelp metadata
  modeHelpSummary: string;
  modeHelpCmdShow: string;
  modeHelpCmdShowDesc: string;
  modeHelpCmdSet: string;
  modeHelpCmdSetDesc: string;

  // replyModeHelp metadata
  replyModeHelpSummary: string;
  replyModeHelpCmdShow: string;
  replyModeHelpCmdShowDesc: string;
  replyModeHelpCmdStream: string;
  replyModeHelpCmdStreamDesc: string;
  replyModeHelpCmdVerbose: string;
  replyModeHelpCmdVerboseDesc: string;
  replyModeHelpCmdFinal: string;
  replyModeHelpCmdFinalDesc: string;
  replyModeHelpCmdReset: string;
  replyModeHelpCmdResetDesc: string;

  // statusHelp metadata
  statusHelpSummary: string;
  statusHelpCmdShow: string;
  statusHelpCmdShowDesc: string;

  // cancelHelp metadata
  cancelHelpSummary: string;
  cancelHelpCmdCancel: string;
  cancelHelpCmdCancelDesc: string;
  cancelHelpCmdCancelAlias: string;
  cancelHelpCmdCancelAliasDesc: string;
  cancelHelpCmdStop: string;
  cancelHelpCmdStopDesc: string;
  cancelHelpCmdStopAlias: string;
  cancelHelpCmdStopAliasDesc: string;
}

export interface NativeSessionMessages {
  // handleNativeSessionList — unsupported transport
  transportNotSupported: string;

  // handleNativeSessionList — no sessions found
  noSessionsFound: (agentDisplayName: string, workspaceLabel: string) => string;
  noSessionsFoundHint: string;

  // handleNativeSessionSelect
  selectPrompt: string;
  noCachedList: string;
  indexOutOfRange: string;

  // attachNativeSession
  attachNotSupported: string;
  alreadySwitched: (agentDisplayName: string, displayAlias: string) => string;
  attachVerificationFailed: (agentDisplayName: string) => string;
  attachedAndSwitched: (agentDisplayName: string, displayAlias: string) => string;

  // resolveNativeTarget / resolveNativeWorkspace
  noContextHint: string;
  agentNotRegistered: (agent: string) => string;
  workspaceNotRegistered: (workspace: string) => string;
  workspacePathNotFound: (cwd: string) => string;
  noWritableConfig: string;

  // renderNativeSessionTableList
  tableHeader: (agentDisplayName: string, workspaceLabel: string) => string;
  tableColNum: string;
  tableColTitle: string;
  tableColUpdatedAt: string;
  tableColId: string;
  tableAttachedLabel: (displayAlias: string) => string;
  tableAttachedCurrent: string;
  tableActions: string;
  tableActionAttach: string;
  tableActionAlias: string;
  tableActionHelp: string;
  tableMore: (cmd: string) => string;

  // renderNativeSessionCardList
  cardHeader: (agentDisplayName: string, workspaceLabel: string) => string;
  cardReplyHint: string;
  cardTimeLabel: (updatedAt: string) => string;
  cardIdLabel: (idTail: string) => string;
  cardAttachedLabel: (displayAlias: string) => string;
  cardAttachedCurrent: string;
  cardActions: string;
  cardActionAttach: string;
  cardActionAlias: string;
  cardActionHelp: string;
  cardMore: (cmd: string) => string;

  // renderNativeListError / renderNativeResumeError
  listError: (agentDisplayName: string, errorMessage: string) => string;
  listErrorHint: string;
  listErrorHelp: string;
  resumeError: (agentDisplayName: string, errorMessage: string) => string;
  resumeErrorHint: string;
  resumeErrorHelp: string;
}

export interface RecoveryMessages {
  // renderTransportError — transient session
  transientSessionFailed: string;
  transientSessionHint: string;

  // renderTransportError — normal session unavailable
  sessionUnavailable: (alias: string) => string;
  sessionUnavailableRenewHint: (alias: string, agent: string, quotedWorkspace: string) => string;
  sessionUnavailableAttachHint: (alias: string, agent: string, quotedWorkspace: string) => string;

  // renderTransportError — partial output
  sessionInterrupted: (alias: string) => string;
  sessionInterruptedHint: string;
  sessionInterruptedError: (summary: string) => string;

  // renderSessionCreationError (AutoInstallFailedError)
  autoInstallHeadlineFixed: string;
  autoInstallHeadlineFailed: string;
  autoInstallOriginalError: string;
  autoInstallStepVerifyFailed: (label: string) => string;
  autoInstallStepError: (label: string, stderrTail: string) => string;
  autoInstallManual: (pkg: string) => string;
  autoInstallLog: (logPath: string) => string;
  autoInstallScopePrecise: (manager?: string, path?: string) => string;
  autoInstallScopeGlobal: string;

  // renderSessionCreationFailure / renderSessionCreationVerificationError
  sessionCreationFailed: string;
  sessionCreationVerificationDetail: string;
  sessionCreationError: (summary: string) => string;
  sessionCreationAttachHint: (alias: string, agent: string, quotedWorkspace: string) => string;
}

export interface ShortcutMessages {
  // handleSessionShortcutCommand — no config
  noConfig: string;

  // agent not registered
  agentNotRegistered: (agent: string, hint: string) => string;
  agentNotRegisteredAvailable: (names: string) => string;
  agentNotRegisteredNone: string;

  // reuse existing logical session
  reuseHeader: (display: string) => string;
  reuseWorkspace: (name: string) => string;
  reuseSession: (display: string) => string;

  // new session created
  createdHeader: (display: string) => string;
  createdNewWorkspace: (name: string, cwd: string) => string;
  createdReusedWorkspace: (name: string) => string;
  createdNewSession: (display: string) => string;

  // renderShortcutSessionCreationError
  creationFailed: (alias: string) => string;
  creationFailedNewWorkspace: (name: string, cwd: string) => string;
  creationFailedReusedWorkspace: (name: string) => string;
  creationFailedSession: string;

  // resolveShortcutWorkspace — workspace errors
  workspaceNotRegistered: (workspace: string, hint: string) => string;
  workspaceAvailable: (names: string) => string;
  workspaceNone: string;
  workspacePathNotFound: (cwd: string) => string;
}

export interface WorkspaceMessages {
  // render-text: renderWorkspaces
  workspacesEmpty: string;
  workspacesHeader: string;

  // handleWorkspaceCreate — no config
  noWritableConfig: string;

  // handleWorkspaceCreate — path not found
  pathNotFound: (cwd: string) => string;

  // handleWorkspaceCreate — name sanitization notice
  nameSanitized: (original: string, saved: string) => string;

  // handleWorkspaceCreate — saved confirmation
  saved: (name: string) => string;

  // handleWorkspaceRemove — no config
  // (reuses noWritableConfig)

  // handleWorkspaceRemove — removed confirmation
  removed: (name: string) => string;

  // workspaceHelp metadata
  helpSummary: string;
  helpCmdList: string;
  helpCmdListDesc: string;
  helpCmdListOrAlias: string;
  helpCmdListOrAliasDesc: string;
  helpCmdNew: string;
  helpCmdNewDesc: string;
  helpCmdRm: string;
  helpCmdRmDesc: string;
}

export interface AgentMessages {
  // render-text: renderAgents
  agentsEmpty: string;
  agentsHeader: string;

  // handleAgentAdd / handleAgentRemove — no config
  noWritableConfig: string;

  // handleAgentAdd — unsupported template
  unsupportedTemplate: (available: string) => string;

  // handleAgentAdd — already exists (identical)
  alreadyExists: (name: string) => string;

  // handleAgentAdd — already exists (different config)
  alreadyExistsDifferent: (name: string) => string;

  // handleAgentAdd — saved confirmation
  saved: (name: string) => string;

  // handleAgentRemove — not found
  notFound: string;

  // handleAgentRemove — removed confirmation
  removed: (name: string) => string;

  // agentHelp metadata
  helpSummary: string;
  helpCmdList: string;
  helpCmdListDesc: string;
  helpCmdAdd: (templates: string) => string;
  helpCmdAddDesc: string;
  helpCmdRm: string;
  helpCmdRmDesc: string;
}

export interface LaterMessages {
  // command-router.ts — scheduled service not enabled
  serviceNotEnabled: string;

  // handleLaterCreate — flags mutually exclusive
  bindAndTempMutuallyExclusive: string;

  // handleLaterCreate — no current session
  noSession: string;
  noSessionHint: string;
  noSessionExampleNew: string;
  noSessionExampleUse: string;

  // handleLaterCreate — slash-prefixed message rejected
  slashMessageRejected: string;
  slashMessageHint: string;
  slashMessageExample: string;

  // handleLaterCancel — success
  cancelSuccess: (id: string) => string;

  // handleLaterCancel — not found
  cancelNotFound: (id: string) => string;
  cancelNotFoundHint: string;

  // renderTimeParseError
  missingMessage: string;
  tooSoon: string;
  outOfRange: string;
  pastTodayTime: (value: string) => string;
  unrecognizedTime: string;
  unrecognizedTimeFormats: string;
  unrecognizedTimeExample1: string;
  unrecognizedTimeExample2: string;
  unrecognizedTimeExample3: string;
  unrecognizedTimeExample4: string;

  // laterHelp metadata
  helpSummary: string;
  helpCmdCreate: string;
  helpCmdCreateDesc: string;
  helpCmdBind: string;
  helpCmdBindDesc: string;
  helpCmdTemp: string;
  helpCmdTempDesc: string;
  helpCmdList: string;
  helpCmdListDesc: string;
  helpCmdCancel: string;
  helpCmdCancelDesc: string;
  helpExample1: string;
  helpExample2: string;
  helpExample3: string;
  helpExample4: string;
  helpExample5: string;
  helpNote1: string;
  helpNote2: string;
  helpNote3: string;
  helpNote4: string;
  helpNote5: string;
  helpNote6: string;
  helpNote7: string;
}

export interface ScheduledRenderMessages {
  // sessionLabel
  tempSession: (workspace: string, agent: string) => string;
  boundSession: (displaySession: string) => string;

  // renderLaterHelp
  helpUsage: string;
  helpCreate: string;
  helpCreateEx1: string;
  helpCreateEx2: string;
  helpCreateEx3: string;
  helpCreateEx4: string;
  helpView: string;
  helpViewCmd: string;
  helpCancel: string;
  helpCancelCmd: string;
  helpNotes: string;
  helpNote1: string;
  helpNote2: string;
  helpNote3: string;
  helpNote4: string;
  helpNote5: string;
  helpNote6: string;
  helpNote7: string;

  // renderLaterUnsupportedChannel
  unsupportedChannel: string;
  unsupportedChannelReason: string;
  unsupportedChannelHint: string;

  // renderTaskCreated
  taskCreated: (id: string) => string;
  taskExecuteAt: (datetime: string) => string;
  taskContent: (preview: string) => string;

  // renderLaterList
  listEmpty: string;
  listHeader: string;

  // formatLocalDateTime — weekdays
  weekdaySun: string;
  weekdayMon: string;
  weekdayTue: string;
  weekdayWed: string;
  weekdayThu: string;
  weekdayFri: string;
  weekdaySat: string;
}

export interface OrchestrationMessages {
  // handler guard — no current session
  noCurrentSession: string;

  // handler guard — orchestration service not enabled
  serviceUnavailable: string;

  // handler — task/group not found
  taskNotFound: string;
  groupNotFound: string;

  // render-text: renderDelegateSuccess
  delegateSuccessCreated: (taskId: string) => string;
  delegateSuccessWorker: (workerSession: string) => string;

  // render-text: renderGroupCreated
  groupCreatedId: (groupId: string) => string;
  groupCreatedTitle: (title: string) => string;

  // render-text: renderGroupList
  groupListEmpty: string;
  groupListHeader: string;

  // render-text: renderGroupSummary
  groupSummaryId: (groupId: string) => string;
  groupSummaryTitle: (title: string) => string;
  groupSummaryCoordinator: (coordinatorSession: string) => string;
  groupSummaryTotal: (count: number) => string;
  groupSummaryPending: (count: number) => string;
  groupSummaryRunning: (count: number) => string;
  groupSummaryCompleted: (count: number) => string;
  groupSummaryFailed: (count: number) => string;
  groupSummaryCancelled: (count: number) => string;
  groupSummaryTerminal: (isTerminal: boolean) => string;
  groupSummaryTerminalYes: string;
  groupSummaryTerminalNo: string;
  groupSummaryInjectionPending: (pending: boolean) => string;
  groupSummaryInjectionAppliedAt: (time: string) => string;
  groupSummaryLastInjectionError: (error: string) => string;
  groupSummaryMembersHeader: string;

  // render-text: renderGroupCancelSuccess
  groupCancelSuccessId: (groupId: string) => string;
  groupCancelSuccessCancelledCount: (count: number) => string;
  groupCancelSuccessSkippedCount: (count: number) => string;

  // render-text: renderTaskList
  taskListEmpty: string;
  taskListHeader: string;

  // render-text: renderTaskSummary
  taskSummaryId: (taskId: string) => string;
  taskSummaryStatus: (status: string) => string;
  taskSummaryCoordinator: (coordinatorSession: string) => string;
  taskSummaryWorker: (workerSession: string) => string;
  taskSummaryWorkerUnassigned: string;
  taskSummaryTargetAgent: (agent: string) => string;
  taskSummaryRole: (role: string) => string;
  taskSummaryGroup: (groupId: string) => string;
  taskSummarySource: (sourceKind: string, sourceHandle: string, roleSuffix: string) => string;
  taskSummaryTask: (task: string) => string;
  taskSummarySummary: (summary: string) => string;
  taskSummaryLatestProgress: (progress: string) => string;
  taskSummaryResult: (result: string) => string;
  taskSummaryTimelineHeader: string;

  // render-text: renderTaskCancelSuccess
  taskCancelAlreadyDone: (taskId: string) => string;
  taskCancelRequested: (taskId: string) => string;
  taskCancelled: (taskId: string) => string;
  taskCurrentStatus: (status: string) => string;

  // render-text: renderTaskApprovalSuccess
  taskApproved: (taskId: string) => string;

  // render-text: renderTaskRejectSuccess
  taskRejected: (taskId: string) => string;

  // render-text: renderTaskConfirmationUnavailable
  taskConfirmationUnavailable: (taskId: string) => string;

  // render-text: renderTasksCleanResult
  tasksCleanEmpty: string;
  tasksCleanRemovedTasks: (count: number) => string;
  tasksCleanRemovedBindings: (count: number) => string;

  // render-text: renderTaskListItem (inline rendering)
  taskListItemGroup: (groupId: string) => string;
  taskListItemSource: (sourceKind: string, sourceHandle: string, roleSuffix: string) => string;
  taskListItemNoticePending: string;
  taskListItemInjectionPending: string;
  taskListItemCancelling: string;

  // render-text: renderGroupListItem (inline rendering)
  groupListItemInjectionPending: string;
  groupListItemTotal: (count: number) => string;
  groupListItemPending: (count: number) => string;
  groupListItemRunning: (count: number) => string;
  groupListItemCompleted: (count: number) => string;
  groupListItemFailed: (count: number) => string;
  groupListItemCancelled: (count: number) => string;

  // render-delegate-group-result: truncate
  truncatedResult: (taskId: string) => string;

  // render-delegate-group-result: pickNextAction
  nextActionNoMembers: string;
  nextActionMixed: string;
  nextActionAllFailed: string;
  nextActionOtherOnly: string;
  nextActionMostlySuccess: string;
  nextActionAllSuccess: string;

  // orchestrationHelp metadata
  helpSummary: string;
  helpCmdDg: string;
  helpCmdDgDesc: string;
  helpCmdDelegate: string;
  helpCmdDelegateDesc: string;
  helpCmdDelegateRole: string;
  helpCmdDelegateRoleDesc: string;
  helpCmdDelegateGroup: string;
  helpCmdDelegateGroupDesc: string;
  helpCmdGroupNew: string;
  helpCmdGroupNewDesc: string;
  helpCmdGroupGet: string;
  helpCmdGroupGetDesc: string;
  helpCmdGroupAdd: string;
  helpCmdGroupAddDesc: string;
  helpCmdGroupAddRole: string;
  helpCmdGroupAddRoleDesc: string;
  helpCmdGroupCancel: string;
  helpCmdGroupCancelDesc: string;
  helpCmdGroups: string;
  helpCmdGroupsDesc: string;
  helpCmdTasks: string;
  helpCmdTasksDesc: string;
  helpCmdTasksStatus: string;
  helpCmdTasksStatusDesc: string;
  helpCmdTasksStuck: string;
  helpCmdTasksStuckDesc: string;
  helpCmdTasksClean: string;
  helpCmdTasksCleanDesc: string;
  helpCmdTaskGet: string;
  helpCmdTaskGetDesc: string;
  helpCmdTaskApprove: string;
  helpCmdTaskApproveDesc: string;
  helpCmdTaskReject: string;
  helpCmdTaskRejectDesc: string;
  helpCmdTaskCancel: string;
  helpCmdTaskCancelDesc: string;
  helpExample1: string;
  helpExample2: string;
  helpExample3: string;
  helpExample4: string;
  helpExample5: string;
  helpExample6: string;
  helpExample7: string;
  helpExample8: string;
  helpExample9: string;
  helpExample10: string;
}

export interface CoordinatorPromptMessages {
  // build-coordinator-prompt.ts — pending results section header
  pendingResultsHeader: string;

  // build-coordinator-prompt.ts — human reply binding section
  humanReplyBindingHeader: string;
  reopenedOutsideSnapshotLabel: string;

  // build-coordinator-prompt.ts — active package still awaiting reply
  activePackageAwaitingReply: string;

  // build-coordinator-prompt.ts — package not yet delivered
  packageNotDelivered: string;

  // build-coordinator-prompt.ts — active package not closed
  activePackageNotClosed: string;
  recentHumanPackageLabel: string;

  // build-coordinator-prompt.ts — user message label
  userMessageLabel: string;
}

export interface WorkerPromptMessages {
  // worker-prompts.ts — buildWorkerTaskPrompt
  taskHeader: string;
  taskIdLabel: (taskId: string) => string;
  taskWorkerSessionLabel: (workerSession: string) => string;
  taskRoleLabel: (role: string) => string;
  taskInstruction: string;
  taskBlockerInstruction: string;
  taskProgressInstruction: string;
  taskProgressNote: string;
  taskContentLabel: (task: string) => string;

  // worker-prompts.ts — buildWorkerAnswerPrompt
  answerHeader: string;
  answerInstruction: string;
  answerLabel: string;
}

export interface ConfigMessages {
  // configHelp metadata
  helpSummary: string;
  helpCmdShow: string;
  helpCmdShowDesc: string;
  helpCmdSet: string;
  helpCmdSetDesc: string;

  // handleConfigShow — section headers
  showSupportedHeader: string;
  showLegacyHeader: string;
  showExamplesHeader: string;

  // handleConfigShow — legacy path display strings
  legacyWechatReplyMode: string;
  legacyChannelType: string;
  legacyChannels: string;

  // handleConfigSet — no writable config
  noWritableConfig: string;

  // handleConfigSet — success
  updated: (path: string, value: string) => string;

  // applySupportedConfigUpdate — language
  languageInvalid: string;

  // applySupportedConfigUpdate — transport.type
  transportTypeInvalid: string;

  // applySupportedConfigUpdate — transport.command
  transportCommandEmpty: string;

  // applySupportedConfigUpdate — transport.permissionMode
  transportPermissionModeInvalid: string;

  // applySupportedConfigUpdate — transport.nonInteractivePermissions
  transportNonInteractiveInvalid: string;

  // applySupportedConfigUpdate — transport.permissionPolicy
  transportPermissionPolicyEmpty: string;

  // applySupportedConfigUpdate — logging.level
  loggingLevelInvalid: string;

  // applySupportedConfigUpdate — positive number validation
  mustBePositiveNumber: (path: string) => string;

  // applySupportedConfigUpdate — channel.type (legacy, write disabled)
  channelTypeDisabled: string;

  // applySupportedConfigUpdate — channel.replyMode
  channelReplyModeInvalid: string;

  // applySupportedConfigUpdate — wechat.replyMode (legacy)
  wechatReplyModeInvalid: string;

  // applySupportedConfigUpdate — wechat.replyMode mapped renderedValue
  wechatReplyModeMapped: (value: string) => string;

  // applySupportedConfigUpdate — dynamic path: agent not found
  agentNotFound: (name: string) => string;

  // applySupportedConfigUpdate — dynamic path: field cannot be empty
  fieldEmpty: (path: string) => string;

  // applySupportedConfigUpdate — dynamic path: workspace not found
  workspaceNotFound: (name: string) => string;

  // applySupportedConfigUpdate — unsupported path
  pathNotSupported: (path: string) => string;
}

export interface PermissionMessages {
  // permissionHelp metadata
  helpSummary: string;
  helpCmdShow: string;
  helpCmdShowDesc: string;
  helpCmdSet: string;
  helpCmdSetDesc: string;
  helpCmdAuto: string;
  helpCmdAutoDesc: string;
  helpCmdAutoSet: string;
  helpCmdAutoSetDesc: string;

  // handlePermissionModeSet / handlePermissionAutoSet — no writable config
  noWritableConfig: string;

  // renderPermissionStatus — title variants
  statusTitleCurrent: string;
  statusTitleAutoStatus: string;
  statusTitleModeUpdated: string;
  statusTitleAutoUpdated: string;
}

export interface HelpMessages {
  // handleInvalidCommand — with dedicated topic
  invalidCommandPrefix: string;

  // handleInvalidCommand — fallback (no topic)
  invalidCommandFallbackHeader: string;
  invalidCommandFallbackFormat: string;
  invalidCommandFallbackExample: string;

  // renderHelpIndex — common entry list
  indexCommonHeader: string;
  indexEntryShortcut: string;
  indexEntryNative: string;
  indexEntryUse: string;
  indexEntryStatus: string;
  indexTopicsHeader: string;
  indexViewTopicHeader: string;
  indexViewTopicExample: string;

  // renderHelpTopic — labels
  topicHeader: (name: string) => string;
  topicSummary: (summary: string) => string;
  topicAliases: (aliases: string) => string;
  topicCommandsHeader: string;
  topicExamplesHeader: string;
  topicNotesHeader: string;

  // renderUnknownHelpTopic
  unknownTopicHeader: (name: string) => string;
  unknownTopicAvailableHeader: string;
}

export interface HintsMessages {
  // listWeacpxCommandHints — /help description
  helpDescription: string;
}

export interface RouterMessages {
  // ensureTransportSession — auto-install progress
  depMissing: (pkg: string) => string;
  depInstallVerifying: string;

  // createProgressHandler — heartbeat / spawn / initializing
  agentHeartbeat: (agent: string, elapsed: number) => string;
  agentSpawning: (agent: string) => string;
  agentInitializing: (agent: string, elapsed: number) => string;

  // createProgressHandler — acpx note with elapsed
  acpxNoteElapsed: (note: string, elapsed: number) => string;
}

export interface AcpxNoteMessages {
  // translateAcpxNote — built-in agent spawn
  spawnBuiltIn: (name: string) => string;

  // translateAcpxNote — generic agent spawn
  spawnAgent: string;

  // translateAcpxNote — downloading deps
  downloading: string;

  // translateAcpxNote — installing/extracting deps
  installing: string;

  // translateAcpxNote — initializing
  initializing: string;

  // translateAcpxNote — fallback raw line
  fallback: (line: string) => string;
}

export interface Messages {
  common: CommonMessages;
  session: SessionMessages;
  nativeSession: NativeSessionMessages;
  recovery: RecoveryMessages;
  shortcut: ShortcutMessages;
  workspace: WorkspaceMessages;
  agent: AgentMessages;
  later: LaterMessages;
  scheduledRender: ScheduledRenderMessages;
  orchestration: OrchestrationMessages;
  coordinatorPrompt: CoordinatorPromptMessages;
  workerPrompt: WorkerPromptMessages;
  config: ConfigMessages;
  permission: PermissionMessages;
  help: HelpMessages;
  hints: HintsMessages;
  router: RouterMessages;
  acpxNote: AcpxNoteMessages;
}
