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
   * Minimum core version required by this plugin (e.g. "0.8.0").
   * First-party plugins must declare this; third-party plugins are encouraged to.
   *
   * The core was renamed weacpx→xacpx at 0.8.0. New plugins should prefer
   * {@link minXacpxVersion}; the legacy `minWeacpxVersion` is still read for
   * already-published plugins (when both are present, `minXacpxVersion` wins).
   */
  minWeacpxVersion?: string;
  /**
   * Optional explicit core compatibility range, e.g. ">=0.3.3" or "^0.3.3".
   * If both a min version and a compatibility range are set, both must hold.
   */
  compatibleWeacpxVersions?: string;
  /** Preferred (post-rename) alias of {@link minWeacpxVersion}. */
  minXacpxVersion?: string;
  /** Preferred (post-rename) alias of {@link compatibleWeacpxVersions}. */
  compatibleXacpxVersions?: string;
  channels?: ChannelPluginDefinition[];
}

/**
 * Post-rename alias for {@link WeacpxPlugin}. New plugins should author against
 * `XacpxPlugin`; the legacy name remains exported for backward compatibility.
 */
export type XacpxPlugin = WeacpxPlugin;
