import type { HelpTopicMetadata } from "./help-types";
import { agentHelp } from "../handlers/agent-handler";
import { configHelp } from "../handlers/config-handler";
import { permissionHelp } from "../handlers/permission-handler";
import {
  cancelHelp,
  modeHelp,
  replyModeHelp,
  sessionHelp,
  statusHelp,
} from "../handlers/session-handler";
import { workspaceHelp } from "../handlers/workspace-handler";

export const HELP_TOPICS: HelpTopicMetadata[] = [
  sessionHelp,
  workspaceHelp,
  agentHelp,
  permissionHelp,
  configHelp,
  modeHelp,
  replyModeHelp,
  statusHelp,
  cancelHelp,
];

const HELP_TOPIC_MAP = new Map<string, HelpTopicMetadata>();
for (const topic of HELP_TOPICS) {
  HELP_TOPIC_MAP.set(topic.topic, topic);
  for (const alias of topic.aliases) {
    HELP_TOPIC_MAP.set(alias, topic);
  }
}

export function getHelpTopic(topic: string): HelpTopicMetadata | null {
  return HELP_TOPIC_MAP.get(topic) ?? null;
}

export function listHelpTopics(): HelpTopicMetadata[] {
  return HELP_TOPICS;
}
