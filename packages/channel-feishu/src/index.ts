import type { XacpxPlugin } from "xacpx/plugin-api";

import { FeishuChannel } from "./channel.js";
import { feishuCliProvider } from "./feishu-provider.js";

export { FeishuChannel } from "./channel.js";
export { feishuCliProvider } from "./feishu-provider.js";

const plugin: XacpxPlugin = {
  apiVersion: 1,
  name: "@ganglion/xacpx-channel-feishu",
  minXacpxVersion: "0.8.0",
  channels: [
    {
      type: "feishu",
      factory: (options, deps) => new FeishuChannel(options, deps),
      cliProvider: feishuCliProvider,
    },
  ],
};

export default plugin;
