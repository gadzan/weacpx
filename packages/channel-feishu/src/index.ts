import type { WeacpxPlugin } from "weacpx/plugin-api";

import { FeishuChannel } from "./channel.js";
import { feishuCliProvider } from "./feishu-provider.js";

export { FeishuChannel } from "./channel.js";
export { feishuCliProvider } from "./feishu-provider.js";

const plugin: WeacpxPlugin = {
  apiVersion: 1,
  name: "@ganglion/weacpx-channel-feishu",
  minWeacpxVersion: "0.3.3",
  channels: [
    {
      type: "feishu",
      factory: (options, deps) => new FeishuChannel(options, deps),
      cliProvider: feishuCliProvider,
    },
  ],
};

export default plugin;
