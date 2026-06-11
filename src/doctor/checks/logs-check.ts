import { stat, readdir } from "node:fs/promises";
import { basename, join } from "node:path";
import { homedir } from "node:os";

import { resolveDaemonPaths, resolveRuntimeDirFromConfigPath, type DaemonPaths } from "../../daemon/daemon-files";
import type { DoctorCheckResult } from "../doctor-types";

/** A single log file over this size (bytes) trips a warn on its own. */
const DEFAULT_SINGLE_FILE_WARN_BYTES = 50 * 1024 * 1024;
/** The combined size of all log files (base + rotation siblings) over this trips a warn. */
const DEFAULT_TOTAL_WARN_BYTES = 200 * 1024 * 1024;

export interface LogsCheckOptions {
  home?: string;
  resolveDaemonPaths?: (options: { home: string; runtimeDir?: string }) => DaemonPaths;
  configPath?: string;
  probe?: LogsFsProbe;
  /** A single log file larger than this (bytes) warns. */
  singleFileWarnBytes?: number;
  /** The total across all log files larger than this (bytes) warns. */
  totalWarnBytes?: number;
}

/** Injected fs seam so tests never touch the real filesystem. */
export interface LogsFsProbe {
  stat(path: string): Promise<{ isDirectory(): boolean; size: number }>;
  readdir(path: string): Promise<string[]>;
}

interface LogFileSize {
  name: string;
  path: string;
  size: number;
}

export async function checkLogs(options: LogsCheckOptions = {}): Promise<DoctorCheckResult> {
  const home = options.home ?? process.env.HOME ?? homedir();
  const runtimeDir = options.configPath ? resolveRuntimeDirFromConfigPath(options.configPath) : undefined;
  const paths = (options.resolveDaemonPaths ?? resolveDaemonPaths)({
    home,
    ...(runtimeDir ? { runtimeDir } : {}),
  });
  const probe = options.probe ?? createLogsFsProbe();
  const singleFileWarnBytes = options.singleFileWarnBytes ?? DEFAULT_SINGLE_FILE_WARN_BYTES;
  const totalWarnBytes = options.totalWarnBytes ?? DEFAULT_TOTAL_WARN_BYTES;

  // A missing runtime dir means the daemon has never written logs here.
  let entries: string[];
  try {
    const dirStat = await probe.stat(paths.runtimeDir);
    if (!dirStat.isDirectory()) {
      return skip(paths.runtimeDir);
    }
    entries = await probe.readdir(paths.runtimeDir);
  } catch (error) {
    if (isMissingPathError(error)) {
      return skip(paths.runtimeDir);
    }
    // An unreadable runtime dir is surfaced by the Runtime check; do not crash here.
    return skip(paths.runtimeDir);
  }

  // Enumerate the base daemon logs plus every rotation sibling: a file in the
  // runtime dir named "<base>" or "<base>.<N>" where N is a positive integer
  // (mirrors rotating-file-writer's "<base>.1", "<base>.2", … naming).
  const baseNames = [basename(paths.appLog), basename(paths.stdoutLog), basename(paths.stderrLog)];
  const tracked = new Set(baseNames);
  const matched = entries.filter((entry) => isTrackedLogName(entry, tracked));

  const files: LogFileSize[] = [];
  for (const name of matched) {
    const path = join(paths.runtimeDir, name);
    try {
      const fileStat = await probe.stat(path);
      if (fileStat.isDirectory()) {
        continue;
      }
      files.push({ name, path, size: fileStat.size });
    } catch {
      // Tolerate a file that is missing/unreadable/vanished between readdir and
      // stat: skip it rather than failing the whole check.
      continue;
    }
  }

  const total = files.reduce((sum, file) => sum + file.size, 0);
  const largestSingle = files.reduce((max, file) => Math.max(max, file.size), 0);
  const overSingle = files.some((file) => file.size > singleFileWarnBytes);
  const overTotal = total > totalWarnBytes;

  const sorted = [...files].sort((a, b) => b.size - a.size);
  const details = [
    ...sorted.map((file) => `${file.name}: ${formatBytes(file.size)}`),
    `total: ${formatBytes(total)}`,
  ];

  if (overSingle || overTotal) {
    const reason = overSingle
      ? `largest single log is ${formatBytes(largestSingle)}`
      : `total is ${formatBytes(total)}`;
    return {
      id: "logs",
      label: "Logs",
      severity: "warn",
      summary: `log growth high: ${reason} (total ${formatBytes(total)})`,
      details,
      suggestions: [
        "logs are large; check disk space and that log rotation is configured (logging.maxSizeBytes / maxFiles)",
      ],
    };
  }

  return {
    id: "logs",
    label: "Logs",
    severity: "pass",
    summary: `logs total ${formatBytes(total)}`,
    details,
  };
}

function skip(runtimeDir: string): DoctorCheckResult {
  return {
    id: "logs",
    label: "Logs",
    severity: "skip",
    summary: "no runtime logs yet",
    details: [`runtimeDir: ${runtimeDir} (missing)`],
  };
}

/**
 * True when `name` is a base daemon log, or a rotation sibling "<base>.<N>"
 * where N is a positive integer.
 */
function isTrackedLogName(name: string, baseNames: Set<string>): boolean {
  if (baseNames.has(name)) {
    return true;
  }
  for (const base of baseNames) {
    const prefix = `${base}.`;
    if (name.startsWith(prefix)) {
      const suffix = name.slice(prefix.length);
      if (/^\d+$/.test(suffix) && Number(suffix) > 0) {
        return true;
      }
    }
  }
  return false;
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) {
    return `${bytes} B`;
  }
  const units = ["KB", "MB", "GB", "TB"];
  let value = bytes / 1024;
  let unitIndex = 0;
  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024;
    unitIndex += 1;
  }
  return `${value.toFixed(1)} ${units[unitIndex]}`;
}

function createLogsFsProbe(): LogsFsProbe {
  return {
    stat: async (path) => await stat(path),
    readdir: async (path) => await readdir(path),
  };
}

function isMissingPathError(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    ((error as NodeJS.ErrnoException).code === "ENOENT" ||
      (error as NodeJS.ErrnoException).code === "ENOTDIR")
  );
}
