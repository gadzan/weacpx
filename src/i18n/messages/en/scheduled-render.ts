import type { ScheduledRenderMessages } from "../../types";

export const scheduledRender: ScheduledRenderMessages = {
  // sessionLabel
  tempSession: (workspace, agent) => `Temp session (${workspace} · ${agent})`,
  boundSession: (displaySession) => `Session: ${displaySession}`,

  // renderLaterHelp
  helpUsage: "Scheduled task usage:",
  helpCreate: "Create:",
  helpCreateEx1: "/lt in 2h check CI",
  helpCreateEx2: "/lt in 30m summarize progress",
  helpCreateEx3: "/lt tomorrow 09:00 review PR",
  helpCreateEx4: "/lt friday 09:00 continue work",
  helpView: "View:",
  helpViewCmd: "/lt list",
  helpCancel: "Cancel:",
  helpCancelCmd: "/lt cancel <id>",
  helpNotes: "Notes:",
  helpNote1: "- One-shot tasks only",
  helpNote2: "- Time must be at least 10 seconds and at most 7 days away",
  helpNote3: "- By default runs in a new temporary session (destroyed after completion)",
  helpNote4: "- Use --bind to send to the session that was current when the task was created",
  helpNote5: "- Trigger notifications and agent replies reuse the existing channel route; WeChat reply quota is controlled by the existing route",
  helpNote6: "- Scheduling slash-prefixed xacpx commands is not supported",
  helpNote7: "- Full time format reference: docs/later-command.md",

  // renderLaterUnsupportedChannel
  unsupportedChannel: "This channel does not support scheduled tasks; no task was created.",
  unsupportedChannelReason: "Reason: this channel has not implemented scheduled message delivery, so the result cannot be sent back to this chat when the task fires.",
  unsupportedChannelHint: "Switch to a channel that supports scheduled tasks before using /lt.",

  // renderTaskCreated
  taskCreated: (id) => `Scheduled task #${id} created`,
  taskExecuteAt: (datetime) => `Execute at: ${datetime}`,
  taskContent: (preview) => `Message: ${preview}`,

  // renderLaterList
  listEmpty: "No pending scheduled tasks.",
  listHeader: "Pending scheduled tasks:",

  // formatLocalDateTime — weekdays
  weekdaySun: "Sun",
  weekdayMon: "Mon",
  weekdayTue: "Tue",
  weekdayWed: "Wed",
  weekdayThu: "Thu",
  weekdayFri: "Fri",
  weekdaySat: "Sat",
};
