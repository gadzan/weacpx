import type { HelpMessages } from "../../types";

export const help: HelpMessages = {
  // handleInvalidCommand — with dedicated topic
  invalidCommandPrefix: "命令格式不正确，请参考下面的用法：",

  // handleInvalidCommand — fallback (no topic)
  invalidCommandFallbackHeader: "无法识别的命令格式。",
  invalidCommandFallbackFormat: "正确的会话创建格式：\n/session new <别名> --agent <Agent名> --ws <工作区名>",
  invalidCommandFallbackExample: "例如：\n/session new demo --agent claude --ws weacpx",

  // renderHelpIndex — common entry list
  indexCommonHeader: "常用入口：",
  indexEntryShortcut: "- /ss <agent> (-d <path> | --ws <name>) - 快速新建或切到会话",
  indexEntryNative: "- /ssn <agent> (-d <path> | --ws <name>) - 接入本地 Agent 原生会话",
  indexEntryUse: "- /use <alias> - 切换当前会话",
  indexEntryStatus: "- /status - 查看当前会话状态",
  indexTopicsHeader: "顶级命令：",
  indexViewTopicHeader: "查看专题说明：",
  indexViewTopicExample: "- 例如：/help ss、/help ssn、/help ws、/help pm",

  // renderHelpTopic — labels
  topicHeader: (name) => `帮助主题：${name}`,
  topicSummary: (summary) => `说明：${summary}`,
  topicAliases: (aliases) => `别名：${aliases}`,
  topicCommandsHeader: "命令：",
  topicExamplesHeader: "示例：",
  topicNotesHeader: "注意：",

  // renderUnknownHelpTopic
  unknownTopicHeader: (name) => `未知帮助主题：${name}`,
  unknownTopicAvailableHeader: "可用主题：",
};
