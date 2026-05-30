import { expect, test } from "bun:test";

import { getWeixinMessageTurnLane } from "../../../../src/weixin/messaging/handle-weixin-message-turn";

// MessageItemType.TEXT = 1 (from src/weixin/api/types.ts)
// extractTextBody reads: item.type === MessageItemType.TEXT && item.text_item?.text
const msg = (text: string) =>
  ({
    item_list: [
      {
        type: 1, // MessageItemType.TEXT
        text_item: { text },
      },
    ],
  }) as any;

test("/use, /ss, and /use - route to the control lane", () => {
  expect(getWeixinMessageTurnLane(msg("/use backend"))).toBe("control");
  expect(getWeixinMessageTurnLane(msg("/ss backend"))).toBe("control");
  expect(getWeixinMessageTurnLane(msg("/use -"))).toBe("control");
});

test("existing control commands stay control; prompts and other commands stay normal", () => {
  expect(getWeixinMessageTurnLane(msg("/cancel"))).toBe("control");
  expect(getWeixinMessageTurnLane(msg("/stop"))).toBe("control");
  expect(getWeixinMessageTurnLane(msg("/jx"))).toBe("control");
  expect(getWeixinMessageTurnLane(msg("hello world"))).toBe("normal");
  expect(getWeixinMessageTurnLane(msg("/status"))).toBe("normal");
  expect(getWeixinMessageTurnLane(msg("/ssn"))).toBe("normal"); // /ssn (native list) must NOT match /ss
});
