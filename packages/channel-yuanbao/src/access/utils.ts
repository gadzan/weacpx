import type { YuanbaoMsgBodyElement } from "./types.js";

export function msgBodyDesensitization(body: YuanbaoMsgBodyElement[] | undefined): unknown {
  return (body ?? []).map((item) => ({ ...item, msg_content: item.msg_content?.text ? { ...item.msg_content, text: "***" } : item.msg_content }));
}
