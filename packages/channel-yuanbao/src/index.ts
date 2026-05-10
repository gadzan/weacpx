import type { WeacpxPlugin } from "weacpx/plugin-api";

import { YuanbaoChannel } from "./channel.js";
import { yuanbaoCliProvider } from "./yuanbao-provider.js";

export { YuanbaoChannel } from "./channel.js";
export { yuanbaoCliProvider } from "./yuanbao-provider.js";

const plugin: WeacpxPlugin = {
  apiVersion: 1,
  name: "@ganglion/weacpx-channel-yuanbao",
  minWeacpxVersion: "0.3.3",
  channels: [
    {
      type: "yuanbao",
      factory: (options) => new YuanbaoChannel(options),
      cliProvider: yuanbaoCliProvider,
    },
  ],
};

export default plugin;
