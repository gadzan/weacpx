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

export interface Messages {
  common: CommonMessages;
  session: SessionMessages;
}
