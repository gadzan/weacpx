import type { ChannelPluginDefinition } from "../channels/plugin.js";
import {
  WEACPX_PLUGIN_API_VERSION,
  WEACPX_PLUGIN_API_SUPPORTED_VERSIONS,
  WEACPX_PLUGIN_MIN_CORE_VERSION,
} from "./compatibility.js";

export {
  WEACPX_PLUGIN_API_VERSION,
  WEACPX_PLUGIN_API_SUPPORTED_VERSIONS,
  WEACPX_PLUGIN_MIN_CORE_VERSION,
};

export interface WeacpxPlugin {
  apiVersion: 1;
  name?: string;
  /**
   * Minimum weacpx core version required by this plugin (e.g. "0.3.3").
   * First-party plugins must declare this; third-party plugins are encouraged to.
   */
  minWeacpxVersion?: string;
  /**
   * Optional explicit weacpx core compatibility range, e.g. ">=0.3.3" or "^0.3.3".
   * If both `minWeacpxVersion` and `compatibleWeacpxVersions` are set, both must hold.
   */
  compatibleWeacpxVersions?: string;
  channels?: ChannelPluginDefinition[];
}
