import type { MigrateMessages } from "../../types";

export const migrate: MigrateMessages = {
  // migrateCoreHome — legacy daemon still alive
  daemonRunning: (pid: number, legacy: string, primary: string) =>
    `检测到运行中的旧守护进程 (pid ${pid})，暂不迁移 ${legacy} → ${primary}；` +
    `请先停止守护进程（weacpx stop / xacpx stop）后重试，期间仍使用旧目录。`,

  // migrateCoreHome — copy succeeded
  copied: (legacy: string, primary: string) =>
    `已将状态目录从 ${legacy} 复制到 ${primary}（旧目录保留为备份，可手动删除）。`,

  // migrateCoreHome — copy failed
  failed: (legacy: string, primary: string, detail: string) =>
    `迁移状态目录 ${legacy} → ${primary} 失败，继续使用旧目录：${detail}`,

  // supplementMissingCoreFiles — per-file supplement copy failed
  supplementFailed: (from: string, to: string, detail: string) =>
    `补迁移 ${from} → ${to} 失败，已跳过：${detail}`,

  // supplementMissingCoreFiles — supplemented missing files from legacy dir
  supplemented: (files: string, primary: string) =>
    `已从旧目录补迁移 ${files} 到 ${primary}（未覆盖任何现有文件）。`,
};
