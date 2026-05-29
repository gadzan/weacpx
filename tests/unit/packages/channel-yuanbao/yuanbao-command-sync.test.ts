import { expect, test } from "bun:test";

import { PLUGIN_VERSION, toSyncInformationData } from "../../../../packages/channel-yuanbao/src/command-sync";
import pkg from "../../../../packages/channel-yuanbao/package.json";

test("toSyncInformationData maps hints to commands with syncType=1 and empty pluginCommands", () => {
  const data = toSyncInformationData({
    botVersion: "0.6.0",
    pluginVersion: "0.2.0",
    botCommands: [{ name: "/help", description: "查看命令帮助。" }],
  });
  expect(data.syncType).toBe(1);
  expect(data.botVersion).toBe("0.6.0");
  expect(data.pluginVersion).toBe("0.2.0");
  expect(data.commandData?.botCommands).toEqual([{ name: "/help", description: "查看命令帮助。" }]);
  expect(data.commandData?.pluginCommands).toEqual([]);
});

test("PLUGIN_VERSION matches the channel package.json", () => {
  expect(PLUGIN_VERSION).toBe((pkg as { version: string }).version);
});
