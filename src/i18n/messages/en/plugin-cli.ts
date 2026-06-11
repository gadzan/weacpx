import type { PluginCliMessages } from "../../types";

export const pluginCli: PluginCliMessages = {
  // listPlugins
  noPlugins: "No plugins installed yet.",
  pluginListHeader: "Plugins:",

  // addPlugin
  unrecognizedArgs: (args) => `Unrecognized arguments: ${args}`,
  pluginSpecHasDoubleQuote: (spec) => `Invalid plugin spec ${spec}: double quotes (") are never valid in an npm package spec.`,
  pluginSpecHasPercentOnWindows: (spec) => `Invalid plugin spec ${spec}: "%" would be mangled by cmd.exe on Windows. Install the package with npm directly instead.`,
  pluginInstallFailed: (packageSpec, error) => `Plugin ${packageSpec} install failed: ${error}`,
  pluginValidateFailed: (recordedName, error) => `Plugin ${recordedName} validation failed: ${error}`,
  pluginInstalled: (recordedName) => `Plugin ${recordedName} installed`,
  providesChannels: (channels) => `Provides channels: ${channels}`,

  // removePlugin
  pluginNotFound: (packageName) => `Plugin not found: ${packageName}`,
  pluginUninstallFailed: (packageName, error) => `Plugin ${packageName} uninstall failed: ${error}`,
  pluginRemoved: (packageName) => `Plugin ${packageName} removed`,

  // updatePlugins
  pluginUpdateFailed: (name, error) => `Plugin ${name} update failed: ${error}`,
  pluginUpdateValidateFailed: (name, message) => `Plugin ${name} validation failed after update: ${message}`,
  pluginRolledBack: (version) => `Rolled back to ${version}`,
  pluginRollbackFailed: (name, version, message) => `Rollback of ${name} to ${version} failed: ${message}`,
  pluginRollbackUnavailable: (name) => `Cannot auto-rollback (${name} has no pinned previous version); manually run xacpx plugin add ${name} to reinstall.`,
  pluginUpdated: (name) => `Plugin ${name} updated`,

  // setPluginEnabled
  pluginEnabledToggled: (packageName, enabled) => `Plugin ${packageName} ${enabled ? "enabled" : "disabled"}`,

  // dependencyGuard
  dependencyGuardBlocked: (ids) => `Channels depending on this plugin: ${ids}. Run xacpx channel rm <id> (or channel disable) first.`,
  dependencyGuardBlockedUnknown: (pluginName, ids) => `Cannot determine the channel types provided by plugin ${pluginName}, and non-built-in channels are still configured: ${ids}. Run xacpx channel rm on them or fix the plugin first.`,

  // doctorPlugins
  pluginDoctorOk: "All plugins OK.",

  // knownPlugins
  noKnownPlugins: "No official plugins in this version.",
  knownPluginsHeader: "Official plugins:",
  knownPluginsInstallLabel: "Install:",
  knownPluginsInstallCmd: "  xacpx plugin add <package>",

  // resolveLocalPluginName
  cannotResolveLocalPluginName: (installSpec) => `Cannot resolve local plugin package name: ${installSpec}`,

  // maybeRestartAfterMutation
  savedNoRestart: "Config saved; changes will take effect after the next `xacpx restart`.",
  savedDaemonIndeterminate: "Config saved; daemon state is indeterminate, skipped auto-restart. Resolve the stale PID/status first.",
  savedDaemonRunning: "Config saved; daemon is running, run `xacpx restart` to apply changes.",
  restartPrompt: "Restart xacpx now to apply changes? [y/N] ",
  savedRestartPending: "Config saved; changes will take effect after the next `xacpx restart`.",
  savedDaemonStopped: "Config saved; daemon is not running, changes will take effect after the next `xacpx start`.",

  // runRestart
  savedRestartFailed: (message) => `Config saved, but restart failed: ${message}`,
  checkLog: (path) => `Check the log: ${path}`,
  orRunLater: "Or run later: xacpx start",

  // validateWeacpxPlugin (validate-plugin.ts)
  pluginNoDefaultExport: (packageName) => `Plugin ${packageName} has no default export as an xacpx plugin definition`,
  pluginNameMismatch: (packageName, name) => `Plugin ${packageName} declared name does not match the installed package name: ${name}`,
  pluginChannelsNotArray: (packageName) => `Plugin ${packageName} channels must be an array`,
  pluginIllegalChannelType: (packageName, type) => `Plugin ${packageName} registered an illegal channel type: ${type}`,
  pluginIllegalChannelTypeNoType: (packageName) => `Plugin ${packageName} registered an illegal channel type`,
  pluginDuplicateChannelType: (packageName, type) => `Plugin ${packageName} registered duplicate channel type: ${type}`,
  pluginMissingFactory: (packageName, type) => `Plugin ${packageName} channel ${type} is missing a factory`,
  pluginInvalidCliProvider: (packageName, type) => `Plugin ${packageName} channel ${type} cliProvider.type must equal the channel type`,

  // validatePluginCompatibility (compatibility.ts)
  compatMissingApiVersion: (packageName) => `Plugin ${packageName} is missing the required apiVersion field`,
  compatUnsupportedApiVersion: (packageName, apiVersion, supported) =>
    `Plugin ${packageName} uses unsupported apiVersion ${apiVersion}; supported: ${supported}; install a compatible plugin version`,
  compatInvalidMinVersion: (packageName, field) => `Plugin ${packageName} invalid metadata: ${field} must be a string (invalid plugin metadata)`,
  compatInvalidMinVersionDetail: (packageName, field, detail) => `Plugin ${packageName} invalid metadata: ${field} (${detail}) (invalid plugin metadata)`,
  compatMinVersionNotSatisfied: (packageName, minVersion, currentVersion) =>
    `Plugin ${packageName} requires xacpx >=${minVersion}; current is ${currentVersion}; upgrade xacpx`,
  compatInvalidCompatibleVersions: (packageName, field) => `Plugin ${packageName} invalid metadata: ${field} must be a string (invalid plugin metadata)`,
  compatInvalidCompatibleVersionsDetail: (packageName, field, detail) => `Plugin ${packageName} invalid metadata: ${field} (${detail}) (invalid plugin metadata)`,
  compatCompatibleVersionsNotSatisfied: (packageName, requirement, currentVersion) =>
    `Plugin ${packageName} requires xacpx ${requirement}; current is ${currentVersion}; upgrade xacpx`,
};
