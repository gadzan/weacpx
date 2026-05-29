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
    return { text: `命令格式不正确，请参考下面的用法：\n\n${renderHelpTopic(entry)}` };
  }

  return {
    text: [
      "无法识别的命令格式。",
      "",
      "正确的会话创建格式：",
      "/session new <别名> --agent <Agent名> --ws <工作区名>",
      "",
      "例如：",
      "/session new demo --agent claude --ws weacpx",
    ].join("\n"),
  };
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
