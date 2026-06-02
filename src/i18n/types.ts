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

export interface Messages {
  common: CommonMessages;
  session: SessionMessages;
  nativeSession: NativeSessionMessages;
  recovery: RecoveryMessages;
  shortcut: ShortcutMessages;
}
