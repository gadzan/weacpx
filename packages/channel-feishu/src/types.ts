export interface FeishuMessageEvent {
  sender: {
    sender_id: {
      open_id?: string;
      user_id?: string;
      union_id?: string;
    };
    sender_type?: string;
    tenant_key?: string;
  };
  message: {
    message_id: string;
    root_id?: string;
    parent_id?: string;
    create_time?: string;
    update_time?: string;
    chat_id: string;
    thread_id?: string;
    chat_type: "p2p" | "group";
    message_type: string;
    content: string;
    mentions?: Array<{
      key: string;
      id: { open_id?: string; user_id?: string; union_id?: string };
      name: string;
      tenant_key?: string;
    }>;
  };
  app_id?: string;
}

export interface FeishuSendResult {
  messageId: string;
  chatId: string;
}

import type { ChannelMediaKind } from "./media-types.js";

export interface FeishuResourceDescriptor {
  kind: ChannelMediaKind;
  fileKey: string;
  fileName?: string;
}

export interface FeishuContentConversionResult {
  text: string;
  resources: FeishuResourceDescriptor[];
  skippedNotes: string[];
}
