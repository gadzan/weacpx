import type { LaterMessages } from "../../types";

export const later: LaterMessages = {
  // command-router.ts — scheduled service not enabled
  serviceNotEnabled: "Scheduled task service is not enabled.",

  // handleLaterCreate — flags mutually exclusive
  bindAndTempMutuallyExclusive: "--bind and --temp cannot be used together.",

  // handleLaterCreate — no current session
  noSession: "No current session; cannot create a scheduled task.",
  noSessionHint: "Create or switch to a session first:",
  noSessionExampleNew: "- /ss codex --ws backend (create and switch)",
  noSessionExampleUse: "- /use backend-codex (switch to an existing session)",

  // handleLaterCreate — slash-prefixed message rejected
  slashMessageRejected: "Scheduling slash-prefixed commands is not supported.",
  slashMessageHint: "If you need the agent to explain a command, describe it in natural language:",
  slashMessageExample: "Example: /lt in 1h explain what /status does",

  // handleLaterCancel — success
  cancelSuccess: (id) => `Cancelled scheduled task #${id}`,

  // handleLaterCancel — not found
  cancelNotFound: (id) => `No pending scheduled task #${id} found.`,
  cancelNotFoundHint: "Use /lt list to view pending tasks.",

  // renderTimeParseError
  missingMessage: "A scheduled task requires a message. Please include the content after the time.",
  tooSoon: "Scheduled task time must be at least 10 seconds in the future.",
  outOfRange: "Scheduled task time cannot exceed 7 days from now.",
  pastTodayTime: (value) => `${value} today has already passed. Specify a future time or use "tomorrow".`,
  unrecognizedTime: "Unrecognized time format.",
  unrecognizedTimeFormats: "Supported formats:",
  unrecognizedTimeExample1: "- /lt in 2h message (2 hours from now)",
  unrecognizedTimeExample2: "- /lt in 30m message",
  unrecognizedTimeExample3: "- /lt tomorrow 09:00 message",
  unrecognizedTimeExample4: "- /lt friday 09:00 message",

  // laterHelp metadata
  helpSummary: "Scheduled tasks: run at a set time in a temp session (or --bind to the current session)",
  helpCmdCreate: "/lt <time> <message>",
  helpCmdCreateDesc: "Create a scheduled task",
  helpCmdBind: "/lt --bind <time> <message>",
  helpCmdBindDesc: "Send to the current session instead",
  helpCmdTemp: "/lt --temp <time> <message>",
  helpCmdTempDesc: "Force a temporary session",
  helpCmdList: "/lt list",
  helpCmdListDesc: "List pending scheduled tasks",
  helpCmdCancel: "/lt cancel <id>",
  helpCmdCancelDesc: "Cancel a scheduled task",
  helpExample1: "/lt in 2h check CI",
  helpExample2: "/lt in 30m summarize progress",
  helpExample3: "/lt tomorrow 09:00 review PR",
  helpExample4: "/lt today 21:30 continue work",
  helpExample5: "/lt friday 09:00 continue work",
  helpNote1: "One-shot tasks only; repeating schedules are not supported",
  helpNote2: "Time must be at least 10 seconds and at most 7 days away",
  helpNote3: "By default runs in a new temporary session that is destroyed after completion",
  helpNote4: "Use --bind to send to the session that was current when the task was created (configurable via later.defaultMode)",
  helpNote5: "/lt list shows all pending tasks globally; in group chats only the owner can cancel",
  helpNote6: "Scheduling slash-prefixed xacpx commands is not supported",
  helpNote7: "Full time format reference: docs/later-command.md",
};
