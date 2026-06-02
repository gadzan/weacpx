import { renderAgents } from "../../formatting/render-text";
import { getAgentTemplate, listAgentTemplates, sameAgentConfig } from "../../config/agent-templates";
import type { HelpTopicMetadata } from "../help/help-types";
import type { CommandRouterContext, RouterResponse } from "../router-types";
import { t } from "../../i18n";

export function agentHelp(): HelpTopicMetadata {
  const a = t().agent;
  return {
    topic: "agent",
    aliases: ["agents"],
    summary: a.helpSummary,
    commands: [
      { usage: a.helpCmdList, description: a.helpCmdListDesc },
      { usage: a.helpCmdAdd(listAgentTemplates().join("|")), description: a.helpCmdAddDesc },
      { usage: a.helpCmdRm, description: a.helpCmdRmDesc },
    ],
    examples: ["/agent add claude", "/agent rm codex"],
  };
}

export function handleAgents(context: CommandRouterContext): RouterResponse {
  return { text: context.config ? renderAgents(context.config) : "No config loaded." };
}

export async function handleAgentAdd(context: CommandRouterContext, templateName: string): Promise<RouterResponse> {
  const a = t().agent;
  if (!context.config || !context.configStore) {
    return { text: a.noWritableConfig };
  }

  const template = getAgentTemplate(templateName);
  if (!template) {
    return { text: a.unsupportedTemplate(listAgentTemplates().join("、")) };
  }

  const existing = context.config.agents[templateName];
  if (existing) {
    if (sameAgentConfig(existing, template)) {
      return { text: a.alreadyExists(templateName) };
    }
    return { text: a.alreadyExistsDifferent(templateName) };
  }

  const updated = await context.configStore.upsertAgent(templateName, template);
  context.replaceConfig(updated);
  return { text: a.saved(templateName) };
}

export async function handleAgentRemove(context: CommandRouterContext, agentName: string): Promise<RouterResponse> {
  const a = t().agent;
  if (!context.config || !context.configStore) {
    return { text: a.noWritableConfig };
  }
  if (!context.config.agents[agentName]) {
    return { text: a.notFound };
  }

  const updated = await context.configStore.removeAgent(agentName);
  context.replaceConfig(updated);
  return { text: a.removed(agentName) };
}
