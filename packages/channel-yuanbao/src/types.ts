import type { AppLogger } from "weacpx/plugin-api";
import type { YuanbaoResolvedAccountConfig } from "./config.js";
import type { WsSyncCommand } from "./access/ws/types.js";

export type YuanbaoChatType = "direct" | "group";

export type YuanbaoLogInfoExt = {
  trace_id?: string;
};

export type ImMsgSeq = {
  msg_seq?: number;
  msg_id?: string;
  msgId?: string;
};

export enum EnumCLawMsgType {
  CLAW_MSG_UNKNOWN = 0,
  CLAW_MSG_GROUP = 1,
  CLAW_MSG_PRIVATE = 2,
}

export type YuanbaoMsgBodyElement = {
  msg_type: string;
  msg_content?: {
    text?: string;
    uuid?: string;
    image_format?: number;
    data?: string;
    desc?: string;
    ext?: string;
    url?: string;
    file_name?: string;
    file_size?: number;
    sound?: string;
    index?: number;
    image_info_array?: Array<{ type?: number; url?: string; size?: number; width?: number; height?: number }>;
    [key: string]: unknown;
  };
};

export type YuanbaoInboundMessage = {
  callback_command?: string;
  from_account?: string;
  to_account?: string;
  sender_nickname?: string;
  group_id?: string;
  group_code?: string;
  group_name?: string;
  msg_seq?: number;
  msg_random?: number;
  msg_time?: number;
  msg_key?: string;
  msg_id?: string;
  msg_body?: YuanbaoMsgBodyElement[];
  cloud_custom_data?: string;
  event_time?: number;
  bot_owner_id?: string;
  recall_msg_seq_list?: ImMsgSeq[];
  claw_msg_type?: EnumCLawMsgType;
  private_from_group_code?: string;
  trace_id?: string;
  seq_id?: string;
};

export interface YuanbaoGatewayInboundMessage {
  accountId: string;
  chatType: YuanbaoChatType;
  raw: YuanbaoInboundMessage;
  /** Optional normalized @bot decision supplied by the gateway when botId is unavailable locally. */
  isAtBot?: boolean;
  /** Optional self-message decision supplied by the gateway after it resolves the bot identity. */
  isFromSelf?: boolean;
}

export interface YuanbaoGatewayStartInput {
  accounts: YuanbaoResolvedAccountConfig[];
  abortSignal: AbortSignal;
  logger: AppLogger;
  onMessage: (message: YuanbaoGatewayInboundMessage) => Promise<void>;
  /** 可选：连接就绪后向元宝后端同步的命令提示；自定义网关可忽略。 */
  commandSync?: {
    botVersion: string;
    pluginVersion: string;
    botCommands: WsSyncCommand[];
  };
}

export interface YuanbaoGatewaySendTextInput {
  account: YuanbaoResolvedAccountConfig;
  chatType: YuanbaoChatType;
  target: string;
  text: string;
  replyContextToken?: string;
}

export interface YuanbaoGatewayReplyHeartbeatInput {
  account: YuanbaoResolvedAccountConfig;
  chatType: YuanbaoChatType;
  target: string;
  originalSenderAccount: string;
  heartbeat: 1 | 2;
  sendTime: number;
}

export interface YuanbaoGateway {
  start(input: YuanbaoGatewayStartInput): Promise<void>;
  sendText(input: YuanbaoGatewaySendTextInput): Promise<{ messageId?: string } | void>;
  sendReplyHeartbeat?(input: YuanbaoGatewayReplyHeartbeatInput): Promise<void>;
  stop?(): void;
}

export type YuanbaoGatewayFactory = (input: { config: import("./config.js").YuanbaoChannelConfig }) => YuanbaoGateway;
