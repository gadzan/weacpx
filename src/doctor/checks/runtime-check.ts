import { constants } from "node:fs";
import { access, stat } from "node:fs/promises";
import { dirname } from "node:path";
import { homedir } from "node:os";

import { resolveDaemonPaths, type DaemonPaths } from "../../daemon/daemon-files";
import type { DoctorCheckResult } from "../doctor-types";

const DIRECTORY_USABLE = constants.W_OK | constants.X_OK;

export interface RuntimeCheckOptions {
  home?: string;
  resolveDaemonPaths?: (options: { home: string }) => DaemonPaths;
  probe?: RuntimeFsProbe;
  platform?: NodeJS.Platform;
}

export async function checkRuntime(options: RuntimeCheckOptions = {}): Promise<DoctorCheckResult> {
  const home = options.home ?? process.env.HOME ?? homedir();
  const paths = (options.resolveDaemonPaths ?? resolveDaemonPaths)({ home });
  const probe = options.probe ?? createRuntimeFsProbe();
  const platform = options.platform ?? process.platform;
  const checks = [
    await checkDirectoryCreatable("runtimeDir", paths.runtimeDir, probe, platform),
    await checkFileCreatable("pidFile", paths.pidFile, probe, platform),
    await checkFileCreatable("statusFile", paths.statusFile, probe, platform),
    await checkFileCreatable("stdoutLog", paths.stdoutLog, probe, platform),
    await checkFileCreatable("stderrLog", paths.stderrLog, probe, platform),
    await checkFileCreatable("appLog", paths.appLog, probe, platform),
  ];

  const failure = checks.find((check) => !check.ok);
  if (failure) {
    return {
      id: "runtime",
      label: "Runtime",
      severity: "fail",
      summary: "daemon runtime paths are not usable",
      details: checks.map((check) => check.detail),
    };
  }

  return {
    id: "runtime",
    label: "Runtime",
    severity: "pass",
    summary: "daemon runtime paths are usable",
    details: checks.map((check) => check.detail),
    metadata: {
      paths,
    },
  };
}

interface PathCheckResult {
  ok: boolean;
  detail: string;
}

interface RuntimeFsProbe {
  stat(path: string): Promise<RuntimePathStat>;
  access(path: string, mode: number): Promise<void>;
}

interface RuntimePathStat {
  isDirectory(): boolean;
}

function createRuntimeFsProbe(): RuntimeFsProbe {
  return {
    stat: async (path) => await stat(path),
    access: async (path, mode) => await access(path, mode),
  };
}

async function checkDirectoryCreatable(
  label: string,
  path: string,
  probe: RuntimeFsProbe,
  platform: NodeJS.Platform,
): Promise<PathCheckResult> {
  try {
    const stats = await probe.stat(path);
    if (!stats.isDirectory()) {
      return {
        ok: false,
        detail: `${label}: ${path} (exists but is not a directory)`,
      };
    }

    await probe.access(path, directoryAccessMode(platform));
    return {
      ok: true,
      detail: `${label}: ${path} (writable)`,
    };
  } catch (error) {
    if (!isMissingPathError(error)) {
      return {
        ok: false,
        detail: `${label}: ${path} (unusable: ${formatError(error)})`,
      };
    }

    const parentCheck = await checkCreatableAncestorDirectory(path, probe, platform);
    if (!parentCheck.ok) {
      return {
        ok: false,
        detail: `${label}: ${path} (parent not writable: ${parentCheck.blockingPath})`,
      };
    }

    return {
      ok: true,
      detail: `${label}: ${path} (creatable via ${parentCheck.creatableFrom})`,
    };
  }
}

async function checkFileCreatable(
  label: string,
  path: string,
  probe: RuntimeFsProbe,
  platform: NodeJS.Platform,
): Promise<PathCheckResult> {
  try {
    const stats = await probe.stat(path);
    if (stats.isDirectory()) {
      return {
        ok: false,
        detail: `${label}: ${path} (exists but is a directory)`,
      };
    }

    await probe.access(path, constants.W_OK);
    return {
      ok: true,
      detail: `${label}: ${path} (writable)`,
    };
  } catch (error) {
    if (!isMissingPathError(error)) {
      return {
        ok: false,
        detail: `${label}: ${path} (unusable: ${formatError(error)})`,
      };
    }

    const parentCheck = await checkCreatableAncestorDirectory(dirname(path), probe, platform);
    if (!parentCheck.ok) {
      return {
        ok: false,
        detail: `${label}: ${path} (parent not writable: ${parentCheck.blockingPath})`,
      };
    }

    return {
      ok: true,
      detail: `${label}: ${path} (creatable via ${parentCheck.creatableFrom})`,
    };
  }
}

interface AncestorDirectoryResult {
  ok: boolean;
  creatableFrom: string;
  blockingPath?: string;
}

async function checkCreatableAncestorDirectory(
  path: string,
  probe: RuntimeFsProbe,
  platform: NodeJS.Platform,
): Promise<AncestorDirectoryResult> {
  try {
    const stats = await probe.stat(path);
    if (!stats.isDirectory()) {
      return {
        ok: false,
        creatableFrom: path,
        blockingPath: path,
      };
    }

    await probe.access(path, directoryAccessMode(platform));
    return {
      ok: true,
      creatableFrom: path,
    };
  } catch (error) {
    if (!isMissingPathError(error)) {
      return {
        ok: false,
        creatableFrom: path,
        blockingPath: path,
      };
    }

    const parent = dirname(path);
    if (parent === path) {
      return {
        ok: false,
        creatableFrom: path,
        blockingPath: path,
      };
    }

    const parentCheck = await checkCreatableAncestorDirectory(parent, probe, platform);
    if (!parentCheck.ok) {
      return parentCheck;
    }

    return {
      ok: true,
      creatableFrom: parentCheck.creatableFrom,
    };
  }
}

function directoryAccessMode(platform: NodeJS.Platform): number {
  return platform === "win32" ? constants.W_OK : DIRECTORY_USABLE;
}

function isMissingPathError(error: unknown): boolean {
  return isErrnoError(error) && (error.code === "ENOENT" || error.code === "ENOTDIR");
}

function isErrnoError(error: unknown): error is NodeJS.ErrnoException {
  return typeof error === "object" && error !== null && "code" in error;
}

function formatError(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }

  return String(error);
}
