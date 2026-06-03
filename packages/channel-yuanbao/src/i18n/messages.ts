/** Per-package bilingual message catalog interface for channel-yuanbao. */
export interface YuanbaoMessages {
  /** Default fallback reply when the agent returns no content. */
  fallbackReply: string;

  /** Validation: at least one usable account is required in multi-account config. */
  accountsNeedUsable: string;

  /** Validation: appKey is missing. */
  missingAppKey: string;

  /** Validation: appSecret is missing. */
  missingAppSecret: string;

  /** Validation: botId is required together with a static token. */
  staticTokenNeedsBotId: string;

  /** Scheduled task failure notice with task ID. */
  scheduledFailureWithId: (taskId: string, message: string) => string;

  /** Scheduled task failure notice without task ID. */
  scheduledFailure: (message: string) => string;

  /** Fallback completion text when the agent returns nothing. */
  taskCompleted: string;

  /** Background execution error notice recorded in the session result. */
  executionError: (message: string) => string;

  /** Background completion ping (done). */
  bgDone: (display: string) => string;

  /** Background completion ping (error). */
  bgError: (display: string) => string;
}
