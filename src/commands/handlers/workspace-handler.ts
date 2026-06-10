import { renderWorkspaces } from "../../formatting/render-text";
import { allocateWorkspaceName, isWorkspaceNameValid, sanitizeWorkspaceName } from "../workspace-name";
import { normalizeWorkspacePath, pathExists } from "../workspace-path";
import type { HelpTopicMetadata } from "../help/help-types";
import type { CommandRouterContext, RouterResponse } from "../router-types";
import { t } from "../../i18n";

export function workspaceHelp(): HelpTopicMetadata {
  const w = t().workspace;
  return {
    topic: "workspace",
    aliases: ["ws", "workspaces"],
    summary: w.helpSummary,
    commands: [
      { usage: w.helpCmdList, description: w.helpCmdListDesc },
      { usage: w.helpCmdListOrAlias, description: w.helpCmdListOrAliasDesc },
      { usage: w.helpCmdNew, description: w.helpCmdNewDesc },
      { usage: w.helpCmdRm, description: w.helpCmdRmDesc },
    ],
    examples: ['/ws new backend -d "/tmp/backend"', "/workspace rm backend"],
  };
}

export function handleWorkspaces(context: CommandRouterContext): RouterResponse {
  return { text: context.config ? renderWorkspaces(context.config) : "No config loaded." };
}

export async function handleWorkspaceCreate(
  context: CommandRouterContext,
  workspaceName: string,
  cwd: string,
  options: { raw?: boolean } = {},
): Promise<RouterResponse> {
  const w = t().workspace;
  if (!context.config || !context.configStore) {
    return { text: w.noWritableConfig };
  }

  const normalizedCwd = normalizeWorkspacePath(cwd);
  if (!(await pathExists(normalizedCwd))) {
    return { text: w.pathNotFound(cwd) };
  }

  let name = workspaceName;
  let notice: string | undefined;
  if (!options.raw && !isWorkspaceNameValid(workspaceName)) {
    const base = sanitizeWorkspaceName(workspaceName);
    name = allocateWorkspaceName(base, context.config.workspaces);
    notice = w.nameSanitized(workspaceName, name);
  }

  // Persist the user's raw input (a `~` stays literal in the file and is
  // expanded at config-load time), but validate the expanded path above.
  const updated = await context.configStore.upsertWorkspace(name, cwd);
  context.replaceConfig(updated);
  const savedLine = w.saved(name);
  return { text: notice ? `${notice}\n${savedLine}` : savedLine };
}

export async function handleWorkspaceRemove(
  context: CommandRouterContext,
  workspaceName: string,
): Promise<RouterResponse> {
  const w = t().workspace;
  if (!context.config || !context.configStore) {
    return { text: w.noWritableConfig };
  }

  const updated = await context.configStore.removeWorkspace(workspaceName);
  context.replaceConfig(updated);
  return { text: w.removed(workspaceName) };
}
