import type { AppLogger } from "weacpx/plugin-api";
import type { WsSyncCommand, WsSyncInformationData } from "./access/ws/types.js";

// 与 packages/channel-yuanbao/package.json 的 version 一致；同步测试校验防漂移。
export const PLUGIN_VERSION = "0.2.0";

// 元宝协议 SyncInformationType.SYNC_INFORMATION_TYPE_COMMANDS。
const SYNC_TYPE_COMMANDS = 1;

export interface YuanbaoCommandSyncInput {
  botVersion: string;
  pluginVersion: string;
  botCommands: WsSyncCommand[];
}

/** 把命令同步入参映射为元宝 WS 的 SyncInformation 请求数据。 */
export function toSyncInformationData(input: YuanbaoCommandSyncInput): WsSyncInformationData {
  return {
    syncType: SYNC_TYPE_COMMANDS,
    botVersion: input.botVersion,
    pluginVersion: input.pluginVersion,
    commandData: {
      botCommands: input.botCommands,
      pluginCommands: [],
    },
  };
}

/** syncCommandsOnReady 所需的最小 WS 客户端能力（便于单测注入假对象）。 */
export interface CommandSyncClient {
  syncInformation(data: WsSyncInformationData): Promise<{ code: number }>;
}

/**
 * 连接就绪（含每次重连）后向元宝后端 best-effort 同步命令提示。
 * - 无命令或客户端缺失时静默跳过；
 * - 失败/后端拒绝只记日志，绝不抛错（fire-and-forget，永远 resolve）。
 * 返回 Promise 仅供测试 await；调用方以 `void` 调用即可。
 */
export async function syncCommandsOnReady(
  client: CommandSyncClient | undefined,
  commandSync: YuanbaoCommandSyncInput | undefined,
  logger: Pick<AppLogger, "info" | "error">,
  accountId: string,
): Promise<void> {
  if (!client || !commandSync || commandSync.botCommands.length === 0) {
    return;
  }
  try {
    const rsp = await client.syncInformation(toSyncInformationData(commandSync));
    if (rsp.code === 0) {
      await logger.info("yuanbao.ws.sync_commands", "synced command hints", {
        accountId,
        code: rsp.code,
        count: commandSync.botCommands.length,
      });
    } else {
      await logger.error("yuanbao.ws.sync_commands_rejected", "command hint sync rejected by backend", {
        accountId,
        code: rsp.code,
        count: commandSync.botCommands.length,
      });
    }
  } catch (err) {
    await logger.error("yuanbao.ws.sync_commands_failed", "command hint sync failed", {
      accountId,
      message: err instanceof Error ? err.message : String(err),
    });
  }
}
