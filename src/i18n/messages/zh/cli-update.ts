import type { CliUpdateMessages } from "../../types";

export const cliUpdate: CliUpdateMessages = {
  // handleUpdateCli — listing header
  updatesAvailable: "可更新项：",

  // handleUpdateCli — unavailable / abort
  unavailableAborted: (names) => `以下项目无法检查最新版本，已取消更新：${names}`,

  // handleUpdateCli — nothing to do
  nothingToUpdate: "没有需要更新的项目。",

  // handleUpdateCli — non-interactive self-update confirmation required
  selfUpdateNeedsConfirmNonInteractive: (name) =>
    `更新 ${name} 本体需要确认；非交互模式请使用 \`${name} update --all\` 或 \`${name} update ${name}\`。`,
  renameNeedsConfirmNonInteractive: (successor) =>
    `weacpx 已更名为 ${successor}；非交互模式请使用 \`weacpx update --all\` 或 \`weacpx update weacpx\` 确认迁移。`,

  // handleUpdateCli — interactive self-update confirmation prompt
  selfUpdateConfirmPrompt: (name) => `确认更新 ${name} 本体？[y/N] `,
  renameConfirmPrompt: (successor) => `weacpx 已更名为 ${successor}，确认迁移到 ${successor}？[y/N] `,

  // handleUpdateCli — confirmation declined
  selfUpdateCancelled: (name) => `已取消更新 ${name} 本体。`,
  renameCancelled: (successor) => `已取消迁移到 ${successor}。`,

  // handleUpdateCli — success messages
  selfUpdated: (name, version) => `${name} 已更新：${version}`,
  renameMigrated: (successor, version) =>
    `weacpx 已更名为 ${successor}，已迁移至 ${successor} ${version}。今后请使用 \`${successor}\` 命令；若此前在后台运行，请用 \`${successor} start\` 重新启动。`,
  pluginUpdated: (name, version) => `插件 ${name} 已更新：${version}`,
  pluginRollbackFailed: (name, version, error) => `回滚 ${name} 到 ${version} 失败：${error}`,
  pluginNotInConfig: (name) => `配置中没有找到插件 ${name}`,
  updateFailed: (name, error) => `${name} 更新失败：${error}`,

  // selectTargets — no target found
  targetNotFound: (name) => `没有找到更新项：${name}`,
  targetVersionUnknown: (name) => `${name} 无法检查最新版本，已跳过。`,

  // selectTargets — non-interactive multi-target
  multiTargetNonInteractive: "检测到已安装插件；非交互模式请使用 `xacpx update --all` 或 `xacpx update <name>`。",

  // selectTargets — interactive selection prompt
  selectionPrompt: "请选择要更新的项目（数字，逗号分隔，a=全部，回车取消）：",
  selectionInvalid: (part) => `无效选择：${part}`,

  // formatTarget
  formatSelf: (name, current, latest) => `${name} (${current} -> ${latest})`,
  formatRename: (successor, current, latest) => `weacpx → ${successor} (${current} -> ${latest}，改名)`,
  formatPlugin: (name, current, latest) => `插件 ${name} (${current} -> ${latest})`,
  versionUnlocked: "未锁定",
  versionUnknown: "无法检查",
};
