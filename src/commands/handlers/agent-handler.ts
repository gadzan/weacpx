import { renderAgents } from "../../formatting/render-text";
import { getAgentTemplate, listAgentTemplates } from "../../config/agent-templates";
import type { HelpTopicMetadata } from "../help/help-types";
import type { CommandRouterContext, RouterResponse } from "../router-types";

export const agentHelp: HelpTopicMetadata = {
  topic: "agent",
  aliases: ["agents"],
  summary: "管理已注册的 Agent。",
  commands: [
    { usage: "/agents", description: "查看当前已注册的 Agent" },
    { usage: "/agent add <codex|claude|opencode|gemini>", description: "添加内置 Agent 模板" },
    { usage: "/agent rm <name>", description: "删除一个 Agent" },
  ],
  examples: ["/agent add claude", "/agent rm codex"],
};

export function handleAgents(context: CommandRouterContext): RouterResponse {
  return { text: context.config ? renderAgents(context.config) : "No config loaded." };
}

export async function handleAgentAdd(context: CommandRouterContext, templateName: string): Promise<RouterResponse> {
  if (!context.config || !context.configStore) {
    return { text: "当前没有加载可写入的配置。" };
  }

  const template = getAgentTemplate(templateName);
  if (!template) {
    return { text: `暂不支持这个 Agent 模板。当前可用：${listAgentTemplates().join("、")}` };
  }

  const updated = await context.configStore.upsertAgent(templateName, template);
  context.replaceConfig(updated);
  return { text: `Agent「${templateName}」已保存` };
}

export async function handleAgentRemove(context: CommandRouterContext, agentName: string): Promise<RouterResponse> {
  if (!context.config || !context.configStore) {
    return { text: "当前没有加载可写入的配置。" };
  }
  if (!context.config.agents[agentName]) {
    return { text: "没有找到这个 Agent。" };
  }

  const updated = await context.configStore.removeAgent(agentName);
  context.replaceConfig(updated);
  return { text: `Agent「${agentName}」已删除` };
}
