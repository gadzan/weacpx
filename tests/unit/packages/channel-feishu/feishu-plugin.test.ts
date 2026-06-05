import { expect, test } from "bun:test";

import plugin, { FeishuChannel, feishuCliProvider } from "../../../../packages/channel-feishu/src/index";
import { validateWeacpxPlugin } from "../../../../src/plugins/validate-plugin";

test("@ganglion/xacpx-channel-feishu exports a valid plugin definition", () => {
  const validated = validateWeacpxPlugin(plugin, "@ganglion/xacpx-channel-feishu", { currentXacpxVersion: "0.8.0" });

  expect(validated.name).toBe("@ganglion/xacpx-channel-feishu");
  expect(validated.channels?.map((channel) => channel.type)).toEqual(["feishu"]);
  expect(validated.channels?.[0]?.cliProvider?.type).toBe("feishu");
});

test("@ganglion/xacpx-channel-feishu declares compatibility metadata", () => {
  expect(plugin.apiVersion).toBe(1);
  expect(plugin.minXacpxVersion).toBe("0.8.0");
});

test("feishu plugin factory creates the FeishuChannel runtime", () => {
  const channel = plugin.channels?.[0]?.factory({ appId: "cli_xxx", appSecret: "secret_xxx" });

  expect(channel).toBeInstanceOf(FeishuChannel);
  expect(channel?.id).toBe("feishu");
  expect(feishuCliProvider.type).toBe("feishu");
});
