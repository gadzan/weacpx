import type { MigrateMessages } from "../../types";

export const migrate: MigrateMessages = {
  // migrateCoreHome — legacy daemon still alive
  daemonRunning: (pid: number, legacy: string, primary: string) =>
    `A legacy daemon is still running (pid ${pid}). Skipping migration ${legacy} → ${primary}. ` +
    `Stop the daemon first (weacpx stop / xacpx stop) and retry. The legacy directory will be used in the meantime.`,

  // migrateCoreHome — copy succeeded
  copied: (legacy: string, primary: string) =>
    `State directory copied from ${legacy} to ${primary} (the old directory is kept as a backup and can be deleted manually).`,

  // migrateCoreHome — copy failed
  failed: (legacy: string, primary: string, detail: string) =>
    `Failed to migrate state directory ${legacy} → ${primary}. Continuing with the old directory: ${detail}`,

  // supplementMissingCoreFiles — per-file supplement copy failed
  supplementFailed: (from: string, to: string, detail: string) =>
    `Failed to supplement ${from} → ${to}; skipped: ${detail}`,

  // supplementMissingCoreFiles — supplemented missing files from legacy dir
  supplemented: (files: string, primary: string) =>
    `Supplemented ${files} from the old directory into ${primary} (no existing files were overwritten).`,
};
