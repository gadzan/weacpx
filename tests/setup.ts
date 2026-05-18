import { bootstrapBuiltinChannels } from "../src/channels/bootstrap.js";
import { join } from "node:path";

if (!process.env.WEACPX_PLUGIN_HOME?.trim()) {
  process.env.WEACPX_PLUGIN_HOME = join(process.cwd(), "undefined", ".weacpx", "plugins");
}

bootstrapBuiltinChannels();
