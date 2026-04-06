import type { NonInteractivePermissions, PermissionMode, AppConfig } from "../../config/types";
import { cloneAppConfig } from "../config-clone";
import type { HelpTopicMetadata } from "../help/help-types";
import type { CommandRouterContext, RouterResponse } from "../router-types";

export const permissionHelp: HelpTopicMetadata = {
  topic: "permission",
  aliases: ["pm"],
  summary: "查看和修改 transport 权限策略。",
  commands: [
    { usage: "/pm 或 /permission", description: "查看当前权限模式" },
    { usage: "/pm set <allow|read|deny>", description: "设置审批级别" },
    { usage: "/pm auto", description: "查看当前非交互策略" },
    { usage: "/pm auto <deny|fail>", description: "设置非交互策略" },
  ],
  examples: ["/pm set read", "/pm auto deny"],
};

export function handlePermissionStatus(context: CommandRouterContext, title: string): RouterResponse {
  return { text: renderPermissionStatus(context.config, title) };
}

export async function handlePermissionModeSet(
  context: CommandRouterContext,
  mode: PermissionMode,
): Promise<RouterResponse> {
  if (!context.config || !context.configStore) {
    return { text: "当前没有加载可写入的配置。" };
  }

  const previous = cloneAppConfig(context.config);
  const updated = await context.configStore.updateTransport({
    permissionMode: mode,
  });
  try {
    await context.transport.updatePermissionPolicy?.(updated.transport);
  } catch (error) {
    await context.configStore.save(previous);
    context.replaceConfig(previous);
    throw error;
  }
  context.replaceConfig(updated);
  return { text: renderPermissionStatus(context.config, "权限模式已更新：") };
}

export function handlePermissionAutoStatus(context: CommandRouterContext, title: string): RouterResponse {
  return { text: renderPermissionStatus(context.config, title) };
}

export async function handlePermissionAutoSet(
  context: CommandRouterContext,
  policy: NonInteractivePermissions,
): Promise<RouterResponse> {
  if (!context.config || !context.configStore) {
    return { text: "当前没有加载可写入的配置。" };
  }

  const previous = cloneAppConfig(context.config);
  const updated = await context.configStore.updateTransport({
    nonInteractivePermissions: policy,
  });
  try {
    await context.transport.updatePermissionPolicy?.(updated.transport);
  } catch (error) {
    await context.configStore.save(previous);
    context.replaceConfig(previous);
    throw error;
  }
  context.replaceConfig(updated);
  return { text: renderPermissionStatus(context.config, "非交互策略已更新：") };
}

export function renderPermissionStatus(config: AppConfig | undefined, title: string): string {
  const permissionMode = config?.transport.permissionMode ?? "approve-all";
  const nonInteractivePermissions = config?.transport.nonInteractivePermissions ?? "deny";

  return [title, `- mode: ${permissionMode}`, `- auto: ${nonInteractivePermissions}`].join("\n");
}
