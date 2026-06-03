import { getHelpTopic, listHelpTopics } from "../help/help-registry";
import type { HelpTopicMetadata } from "../help/help-types";
import type { RouterResponse } from "../router-types";
import { t } from "../../i18n";

export function handleHelp(topic?: string): RouterResponse {
  if (!topic) {
    return { text: renderHelpIndex() };
  }

  const entry = getHelpTopic(topic);
  if (!entry) {
    return { text: renderUnknownHelpTopic(topic) };
  }

  return { text: renderHelpTopic(entry) };
}

/**
 * Render the response for a recognized-but-malformed command (parse kind
 * "invalid"). Shows that specific command's help when a help topic exists
 * (e.g. a bare `/delegate` → orchestration help, instead of the misleading
 * session-creation message). Falls back to the session-creation hint only for
 * recognized commands without a dedicated topic.
 */
export function handleInvalidCommand(recognizedCommand: string): RouterResponse {
  const topicName = recognizedCommand.replace(/^\//, "");
  const entry = getHelpTopic(topicName);
  if (entry) {
    return { text: `${t().help.invalidCommandPrefix}\n\n${renderHelpTopic(entry)}` };
  }

  return {
    text: [
      t().help.invalidCommandFallbackHeader,
      "",
      t().help.invalidCommandFallbackFormat,
      "",
      t().help.invalidCommandFallbackExample,
    ].join("\n"),
  };
}

function renderHelpIndex(): string {
  const topics = listHelpTopics();
  return [
    t().help.indexCommonHeader,
    t().help.indexEntryShortcut,
    t().help.indexEntryNative,
    t().help.indexEntryUse,
    t().help.indexEntryStatus,
    "",
    t().help.indexTopicsHeader,
    ...topics.map((topic) => `- ${topic.topic} - ${topic.summary}`),
    "",
    t().help.indexViewTopicHeader,
    "- /help <topic>",
    t().help.indexViewTopicExample,
  ].join("\n");
}

function renderHelpTopic(topic: HelpTopicMetadata): string {
  return [
    t().help.topicHeader(topic.topic),
    t().help.topicSummary(topic.summary),
    ...(topic.aliases.length > 0 ? [t().help.topicAliases(topic.aliases.join("、"))] : []),
    "",
    t().help.topicCommandsHeader,
    ...topic.commands.map((command) => `- ${command.usage} - ${command.description}`),
    ...(topic.examples && topic.examples.length > 0 ? ["", t().help.topicExamplesHeader, ...topic.examples.map((example) => `- ${example}`)] : []),
    ...(topic.notes && topic.notes.length > 0 ? ["", t().help.topicNotesHeader, ...topic.notes.map((note) => `- ${note}`)] : []),
  ].join("\n");
}

function renderUnknownHelpTopic(topic: string): string {
  return [
    t().help.unknownTopicHeader(topic),
    "",
    t().help.unknownTopicAvailableHeader,
    ...listHelpTopics().map((entry) => `- ${entry.topic}`),
  ].join("\n");
}
