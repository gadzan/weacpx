import type { AgentConfig } from "./types";

const TEMPLATES: Record<string, AgentConfig> = {
  codex: {
    driver: "codex",
  },
  claude: {
    driver: "claude",
  },
};

export function getAgentTemplate(name: string): AgentConfig | null {
  const template = TEMPLATES[name];
  if (!template) {
    return null;
  }

  return {
    ...template,
  };
}

export function listAgentTemplates(): string[] {
  return Object.keys(TEMPLATES);
}
