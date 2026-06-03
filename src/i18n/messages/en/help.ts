import type { HelpMessages } from "../../types";

export const help: HelpMessages = {
  // handleInvalidCommand — with dedicated topic
  invalidCommandPrefix: "Invalid command format. See usage below:",

  // handleInvalidCommand — fallback (no topic)
  invalidCommandFallbackHeader: "Unrecognized command format.",
  invalidCommandFallbackFormat: "Correct session creation format:\n/session new <alias> --agent <AgentName> --ws <WorkspaceName>",
  invalidCommandFallbackExample: "Example:\n/session new demo --agent claude --ws weacpx",

  // renderHelpIndex — common entry list
  indexCommonHeader: "Quick access:",
  indexEntryShortcut: "- /ss <agent> (-d <path> | --ws <name>) - quickly create or switch to a session",
  indexEntryNative: "- /ssn <agent> (-d <path> | --ws <name>) - attach to a local Agent native session",
  indexEntryUse: "- /use <alias> - switch current session",
  indexEntryStatus: "- /status - view current session status",
  indexTopicsHeader: "Top-level commands:",
  indexViewTopicHeader: "View topic help:",
  indexViewTopicExample: "- Examples: /help ss, /help ssn, /help ws, /help pm",

  // renderHelpTopic — labels
  topicHeader: (name) => `Help topic: ${name}`,
  topicSummary: (summary) => `Description: ${summary}`,
  topicAliases: (aliases) => `Aliases: ${aliases}`,
  topicCommandsHeader: "Commands:",
  topicExamplesHeader: "Examples:",
  topicNotesHeader: "Notes:",

  // renderUnknownHelpTopic
  unknownTopicHeader: (name) => `Unknown help topic: ${name}`,
  unknownTopicAvailableHeader: "Available topics:",
};
