import type { NonInteractivePermissions, PermissionMode, AppConfig } from "../../config/types";
import type { CommandRouterContext, RouterResponse } from "../router-types";

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

  const updated = await context.configStore.updateTransport({
    permissionMode: mode,
  });
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

  const updated = await context.configStore.updateTransport({
    nonInteractivePermissions: policy,
  });
  context.replaceConfig(updated);
  return { text: renderPermissionStatus(context.config, "非交互策略已更新：") };
}

export function renderPermissionStatus(config: AppConfig | undefined, title: string): string {
  const permissionMode = config?.transport.permissionMode ?? "approve-all";
  const nonInteractivePermissions = config?.transport.nonInteractivePermissions ?? "fail";

  return [title, `- mode: ${permissionMode}`, `- auto: ${nonInteractivePermissions}`].join("\n");
}
