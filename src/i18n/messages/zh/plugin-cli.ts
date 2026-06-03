import type { PluginCliMessages } from "../../types";

export const pluginCli: PluginCliMessages = {
  // listPlugins
  noPlugins: "还没有安装插件。",
  pluginListHeader: "插件：",

  // addPlugin
  unrecognizedArgs: (args) => `未识别的参数：${args}`,
  pluginInstallFailed: (packageSpec, error) => `插件 ${packageSpec} 安装失败：${error}`,
  pluginValidateFailed: (recordedName, error) => `插件 ${recordedName} 校验失败：${error}`,
  pluginInstalled: (recordedName) => `插件 ${recordedName} 已安装`,
  providesChannels: (channels) => `提供频道：${channels}`,

  // removePlugin
  pluginNotFound: (packageName) => `没有找到插件：${packageName}`,
  pluginUninstallFailed: (packageName, error) => `插件 ${packageName} 卸载失败：${error}`,
  pluginRemoved: (packageName) => `插件 ${packageName} 已移除`,

  // updatePlugins
  pluginUpdateFailed: (name, error) => `插件 ${name} 更新失败：${error}`,
  pluginUpdateValidateFailed: (name, message) => `插件 ${name} 更新后校验失败：${message}`,
  pluginRolledBack: (version) => `已回滚到 ${version}`,
  pluginRollbackFailed: (name, version, message) => `回滚 ${name} 到 ${version} 失败：${message}`,
  pluginRollbackUnavailable: (name) => `无法自动回滚（${name} 未锁定先前版本）；请手动 xacpx plugin add ${name} 重装。`,
  pluginUpdated: (name) => `插件 ${name} 已更新`,

  // setPluginEnabled
  pluginEnabledToggled: (packageName, enabled) => `插件 ${packageName} 已${enabled ? "启用" : "禁用"}`,

  // dependencyGuard
  dependencyGuardBlocked: (ids) => `存在依赖该插件的频道：${ids}。请先执行 xacpx channel rm <id>（或 channel disable）后再操作。`,
  dependencyGuardBlockedUnknown: (pluginName, ids) => `无法确定插件 ${pluginName} 提供的频道类型，且当前仍配置了非内置频道：${ids}。请先 xacpx channel rm 它们或修复插件后再试。`,

  // doctorPlugins
  pluginDoctorOk: "插件检查通过。",

  // knownPlugins
  noKnownPlugins: "当前版本没有官方插件。",
  knownPluginsHeader: "官方插件：",
  knownPluginsInstallLabel: "安装：",
  knownPluginsInstallCmd: "  xacpx plugin add <package>",

  // resolveLocalPluginName
  cannotResolveLocalPluginName: (installSpec) => `无法识别本地插件包名：${installSpec}`,

  // maybeRestartAfterMutation
  savedNoRestart: "配置已保存；变更会在下次 `xacpx restart` 后生效。",
  savedDaemonIndeterminate: "配置已保存；daemon 状态异常，已跳过自动重启。请先处理 stale PID/status。",
  savedDaemonRunning: "配置已保存；daemon 正在运行，请执行 `xacpx restart` 使变更生效。",
  restartPrompt: "现在重启 xacpx 使变更生效？[y/N] ",
  savedRestartPending: "配置已保存；变更会在下次 `xacpx restart` 后生效。",
  savedDaemonStopped: "配置已保存；daemon 未运行，变更会在下次 `xacpx start` 后生效。",

  // runRestart
  savedRestartFailed: (message) => `配置已保存，但重启失败：${message}`,
  checkLog: (path) => `请查看日志：${path}`,
  orRunLater: "也可以稍后执行：xacpx start",

  // validateWeacpxPlugin (validate-plugin.ts)
  pluginNoDefaultExport: (packageName) => `插件 ${packageName} 没有默认导出 xacpx plugin definition`,
  pluginNameMismatch: (packageName, name) => `插件 ${packageName} 声明的 name 与安装包名不一致：${name}`,
  pluginChannelsNotArray: (packageName) => `插件 ${packageName} 的 channels 必须是数组`,
  pluginIllegalChannelType: (packageName, type) => `插件 ${packageName} 注册了非法频道类型：${type}`,
  pluginIllegalChannelTypeNoType: (packageName) => `插件 ${packageName} 注册了非法频道类型`,
  pluginDuplicateChannelType: (packageName, type) => `插件 ${packageName} 重复注册频道类型：${type}`,
  pluginMissingFactory: (packageName, type) => `插件 ${packageName} 的频道 ${type} 缺少 factory`,
  pluginInvalidCliProvider: (packageName, type) => `插件 ${packageName} 的频道 ${type} cliProvider.type 必须等于频道 type`,

  // validatePluginCompatibility (compatibility.ts)
  compatMissingApiVersion: (packageName) => `插件 ${packageName} 缺少必需字段 apiVersion`,
  compatUnsupportedApiVersion: (packageName, apiVersion, supported) =>
    `插件 ${packageName} 使用不支持的 apiVersion ${apiVersion}; supported: ${supported}; 请安装与当前 xacpx 兼容的插件版本 (install a compatible plugin)`,
  compatInvalidMinVersion: (packageName, field) => `插件 ${packageName} 元数据非法：${field} 必须是字符串 (invalid plugin metadata)`,
  compatInvalidMinVersionDetail: (packageName, field, detail) => `插件 ${packageName} 元数据非法：${field} (${detail}) (invalid plugin metadata)`,
  compatMinVersionNotSatisfied: (packageName, minVersion, currentVersion) =>
    `插件 ${packageName} requires xacpx >=${minVersion}; current is ${currentVersion}; upgrade xacpx`,
  compatInvalidCompatibleVersions: (packageName, field) => `插件 ${packageName} 元数据非法：${field} 必须是字符串 (invalid plugin metadata)`,
  compatInvalidCompatibleVersionsDetail: (packageName, field, detail) => `插件 ${packageName} 元数据非法：${field} (${detail}) (invalid plugin metadata)`,
  compatCompatibleVersionsNotSatisfied: (packageName, requirement, currentVersion) =>
    `插件 ${packageName} requires xacpx ${requirement}; current is ${currentVersion}; upgrade xacpx`,
};
