import { basenameForWorkspacePath, normalizeWorkspacePath } from "./commands/workspace-path.js";
import { allocateWorkspaceName, sanitizeWorkspaceName } from "./commands/workspace-name.js";
import { DEFAULT_HOME_WORKSPACE_NAME } from "./config/default-workspace.js";
import type { AppConfig } from "./config/types.js";
import type { AppState } from "./state/types.js";
import { listAgentTemplates, getAgentTemplate } from "./config/agent-templates.js";

export interface OnboardingDeps {
  cwd: () => string;
  print: (line: string) => void;
  isInteractive: () => boolean;
  promptText: (message: string) => Promise<string>;
}

export interface FirstRunOnboardingPlan {
  alias: string;
  agent: string;
  workspace: string;
  rollback: {
    workspaceExisted: boolean;
    agentExisted: boolean;
  };
}

export type OnboardingResult =
  | ({ created: true } & FirstRunOnboardingPlan)
  | { created: false };

export function isFirstUse(config: Pick<AppConfig, "workspaces" | "plugins">, state: Pick<AppState, "sessions">): boolean {
  // A config carrying only the seeded `home` workspace is still "first use":
  // the seed gives users something usable, but it shouldn't suppress the
  // interactive onboarding (add current dir + initial session).
  const workspaceNames = Object.keys(config.workspaces ?? {});
  const onlyDefaultOrEmpty =
    workspaceNames.length === 0 ||
    (workspaceNames.length === 1 && workspaceNames[0] === DEFAULT_HOME_WORKSPACE_NAME);
  return Object.keys(state.sessions ?? {}).length === 0 &&
    onlyDefaultOrEmpty &&
    (config.plugins ?? []).length === 0;
}

export async function maybeRunFirstUseOnboarding(input: {
  config: AppConfig;
  state: AppState;
  saveConfig: (config: AppConfig) => Promise<void>;
  deps: OnboardingDeps;
}): Promise<OnboardingResult> {
  if (!isFirstUse(input.config, input.state)) return { created: false };
  if (!input.deps.isInteractive()) return { created: false };

  const cwd = normalizeWorkspacePath(input.deps.cwd());
  const workspaceName = allocateWorkspaceName(
    sanitizeWorkspaceName(basenameForWorkspacePath(cwd)),
    input.config.workspaces,
  );
  const yes = (await input.deps.promptText(`检测到首次使用 weacpx。是否将当前目录创建为工作区「${workspaceName}」？[Y/n] `)).trim().toLowerCase();
  if (yes === "n" || yes === "no") return { created: false };

  const templateNames = listAgentTemplates();
  input.deps.print("请选择要添加并创建初始会话的 Agent：");
  for (let index = 0; index < templateNames.length; index += 1) {
    input.deps.print(`${index + 1}. ${templateNames[index]}`);
  }
  const answer = (await input.deps.promptText("输入数字或名称（默认 1）：")).trim();
  const agentName = resolveTemplateChoice(answer, templateNames);
  if (!agentName) {
    input.deps.print("未选择有效 Agent，已跳过首次初始化。");
    return { created: false };
  }

  const template = getAgentTemplate(agentName);
  if (!template) return { created: false };

  const workspaceExisted = Boolean(input.config.workspaces[workspaceName]);
  const agentExisted = Boolean(input.config.agents[agentName]);

  input.config.workspaces[workspaceName] = { cwd };
  input.config.agents[agentName] = template;
  await input.saveConfig(input.config);

  const alias = `${workspaceName}:${agentName}`;
  input.deps.print(`已创建工作区「${workspaceName}」，正在创建初始会话「${alias}」...`);
  return {
    created: true,
    workspace: workspaceName,
    agent: agentName,
    alias,
    rollback: { workspaceExisted, agentExisted },
  };
}

function resolveTemplateChoice(answer: string, names: string[]): string | null {
  if (!answer) return names[0] ?? null;
  const index = Number.parseInt(answer, 10);
  if (Number.isFinite(index) && index >= 1 && index <= names.length) return names[index - 1]!;
  return names.includes(answer) ? answer : null;
}
