import { expect, test } from "bun:test";

import plugin, { FeishuChannel, feishuCliProvider } from "../../../../packages/channel-feishu/src/index";
import { validateWeacpxPlugin } from "../../../../src/plugins/validate-plugin";

test("@ganglion/weacpx-channel-feishu exports a valid plugin definition", () => {
  const validated = validateWeacpxPlugin(plugin, "@ganglion/weacpx-channel-feishu", { currentWeacpxVersion: "0.4.0" });

  expect(validated.name).toBe("@ganglion/weacpx-channel-feishu");
  expect(validated.channels?.map((channel) => channel.type)).toEqual(["feishu"]);
  expect(validated.channels?.[0]?.cliProvider?.type).toBe("feishu");
});

test("@ganglion/weacpx-channel-feishu declares D3 compatibility metadata", () => {
  expect(plugin.apiVersion).toBe(1);
  expect(plugin.minWeacpxVersion).toBe("0.4.0");
});

test("feishu plugin factory creates the FeishuChannel runtime", () => {
  const channel = plugin.channels?.[0]?.factory({ appId: "cli_xxx", appSecret: "secret_xxx" });

  expect(channel).toBeInstanceOf(FeishuChannel);
  expect(channel?.id).toBe("feishu");
  expect(feishuCliProvider.type).toBe("feishu");
});
