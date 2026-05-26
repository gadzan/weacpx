import { getHelpTopic, listHelpTopics } from "../help/help-registry";
import type { HelpTopicMetadata } from "../help/help-types";
import type { RouterResponse } from "../router-types";

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

function renderHelpIndex(): string {
  const topics = listHelpTopics();
  return [
    "常用入口：",
    "- /ss <agent> (-d <path> | --ws <name>) - 快速新建或切到会话",
    "- /ssn <agent> (-d <path> | --ws <name>) - 接入本地 Agent 原生会话",
    "- /use <alias> - 切换当前会话",
    "- /status - 查看当前会话状态",
    "",
    "顶级命令：",
    ...topics.map((topic) => `- ${topic.topic} - ${topic.summary}`),
    "",
    "查看专题说明：",
    "- /help <topic>",
    "- 例如：/help ss、/help ssn、/help ws、/help pm",
  ].join("\n");
}

function renderHelpTopic(topic: HelpTopicMetadata): string {
  return [
    `帮助主题：${topic.topic}`,
    `说明：${topic.summary}`,
    ...(topic.aliases.length > 0 ? [`别名：${topic.aliases.join("、")}`] : []),
    "",
    "命令：",
    ...topic.commands.map((command) => `- ${command.usage} - ${command.description}`),
    ...(topic.examples && topic.examples.length > 0 ? ["", "示例：", ...topic.examples.map((example) => `- ${example}`)] : []),
    ...(topic.notes && topic.notes.length > 0 ? ["", "注意：", ...topic.notes.map((note) => `- ${note}`)] : []),
  ].join("\n");
}

function renderUnknownHelpTopic(topic: string): string {
  return [
    `未知帮助主题：${topic}`,
    "",
    "可用主题：",
    ...listHelpTopics().map((entry) => `- ${entry.topic}`),
  ].join("\n");
}
