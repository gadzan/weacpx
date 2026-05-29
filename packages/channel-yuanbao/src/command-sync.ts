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
