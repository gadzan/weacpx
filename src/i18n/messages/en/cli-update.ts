import type { CliUpdateMessages } from "../../types";

export const cliUpdate: CliUpdateMessages = {
  // handleUpdateCli — listing header
  updatesAvailable: "Available updates:",

  // handleUpdateCli — unavailable / abort
  unavailableAborted: (names) => `Cannot check the latest version for the following items; update cancelled: ${names}`,

  // handleUpdateCli — nothing to do
  nothingToUpdate: "Nothing to update.",

  // handleUpdateCli — non-interactive self-update confirmation required
  selfUpdateNeedsConfirmNonInteractive: (name) =>
    `Updating the ${name} core requires confirmation; in non-interactive mode use \`${name} update --all\` or \`${name} update ${name}\`.`,
  renameNeedsConfirmNonInteractive: (successor) =>
    `weacpx has been renamed to ${successor}; in non-interactive mode use \`weacpx update --all\` or \`weacpx update weacpx\` to confirm the migration.`,

  // handleUpdateCli — interactive self-update confirmation prompt
  selfUpdateConfirmPrompt: (name) => `Confirm update of ${name} core? [y/N] `,
  renameConfirmPrompt: (successor) => `weacpx has been renamed to ${successor}. Confirm migration to ${successor}? [y/N] `,

  // handleUpdateCli — confirmation declined
  selfUpdateCancelled: (name) => `Update of ${name} core cancelled.`,
  renameCancelled: (successor) => `Migration to ${successor} cancelled.`,

  // handleUpdateCli — success messages
  selfUpdated: (name, version) => `${name} updated: ${version}`,
  renameMigrated: (successor, version) =>
    `weacpx has been renamed to ${successor}. Migrated to ${successor} ${version}. Use the \`${successor}\` command going forward; if it was running in the background, restart with \`${successor} start\`.`,
  pluginUpdated: (name, version) => `Plugin ${name} updated: ${version}`,
  pluginRollbackFailed: (name, version, error) => `Failed to roll back ${name} to ${version}: ${error}`,
  pluginNotInConfig: (name) => `Plugin ${name} not found in config`,
  updateFailed: (name, error) => `${name} update failed: ${error}`,

  // selectTargets — no target found
  targetNotFound: (name) => `Update target not found: ${name}`,
  targetVersionUnknown: (name) => `${name}: cannot check latest version; skipped.`,

  // selectTargets — non-interactive multi-target
  multiTargetNonInteractive: "Installed plugins detected; in non-interactive mode use `xacpx update --all` or `xacpx update <name>`.",

  // selectTargets — interactive selection prompt
  selectionPrompt: "Select items to update (numbers, comma-separated; a=all; Enter to cancel): ",
  selectionInvalid: (part) => `Invalid selection: ${part}`,

  // formatTarget
  formatSelf: (name, current, latest) => `${name} (${current} -> ${latest})`,
  formatRename: (successor, current, latest) => `weacpx → ${successor} (${current} -> ${latest}, rename)`,
  formatPlugin: (name, current, latest) => `Plugin ${name} (${current} -> ${latest})`,
  versionUnlocked: "unpinned",
  versionUnknown: "unknown",
};
