import { constants } from "node:fs";
import { access, stat } from "node:fs/promises";
import { dirname } from "node:path";
import { homedir } from "node:os";

import { resolveDaemonPaths, resolveRuntimeDirFromConfigPath, type DaemonPaths } from "../../daemon/daemon-files";
import { ensurePrivateRuntimeDir } from "../../daemon/private-runtime-dir";
import type { DoctorCheckResult, DoctorFix } from "../doctor-types";

const DIRECTORY_USABLE = constants.W_OK | constants.X_OK;
/** The runtime dir must be user-private (0700); see ensurePrivateRuntimeDir. */
const PRIVATE_DIR_MODE = 0o700;

export interface RuntimeCheckOptions {
  home?: string;
  resolveDaemonPaths?: (options: { home: string; runtimeDir?: string }) => DaemonPaths;
  configPath?: string;
  probe?: RuntimeFsProbe;
  platform?: NodeJS.Platform;
  /** Injected so the attached repair never touches the real filesystem in tests. */
  ensurePrivateRuntimeDir?: (runtimeDir: string) => Promise<void>;
}

export async function checkRuntime(options: RuntimeCheckOptions = {}): Promise<DoctorCheckResult> {
  const home = options.home ?? process.env.HOME ?? homedir();
  const runtimeDir = options.configPath ? resolveRuntimeDirFromConfigPath(options.configPath) : undefined;
  const paths = (options.resolveDaemonPaths ?? resolveDaemonPaths)({
    home,
    ...(runtimeDir ? { runtimeDir } : {}),
  });
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

  // The dir is usable, but it may still need privacy hardening: a missing dir
  // (about to be created) or — on POSIX — a present dir whose mode has group/
  // other bits set. Both are repaired by ensurePrivateRuntimeDir (create +
  // chmod 0700). This downgrades an otherwise-passing dir to a warn so the
  // world-readable orchestration socket directory is surfaced and fixable.
  const privacy = await inspectRuntimeDirPrivacy(paths.runtimeDir, probe, platform);
  if (privacy.needsRepair) {
    return {
      id: "runtime",
      label: "Runtime",
      severity: "warn",
      summary: "daemon runtime dir should be private (mode 0700)",
      details: [...checks.map((check) => check.detail), privacy.detail],
      fixes: [createEnsurePrivateDirFix(paths.runtimeDir, options.ensurePrivateRuntimeDir)],
      metadata: {
        paths,
      },
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

interface RuntimeDirPrivacy {
  needsRepair: boolean;
  detail: string;
}

/**
 * Decide whether the runtime dir warrants the ensure-private-dir repair. On
 * win32 POSIX modes do not apply (mirror ensurePrivateRuntimeDir's own no-op),
 * so privacy is never flagged there. Otherwise: a missing dir needs creating
 * (with mode 0700), and a present dir whose mode (mask 0o777) is not exactly
 * 0700 needs a chmod repair. A stat that reports no mode (older probes) is
 * treated as fine — only definitive wrong bits trigger the fix.
 */
async function inspectRuntimeDirPrivacy(
  runtimeDir: string,
  probe: RuntimeFsProbe,
  platform: NodeJS.Platform,
): Promise<RuntimeDirPrivacy> {
  if (platform === "win32") {
    return { needsRepair: false, detail: "" };
  }

  try {
    const stats = await probe.stat(runtimeDir);
    if (typeof stats.mode !== "number") {
      return { needsRepair: false, detail: "" };
    }
    const mode = stats.mode & 0o777;
    if (mode === PRIVATE_DIR_MODE) {
      return { needsRepair: false, detail: "" };
    }
    return {
      needsRepair: true,
      detail: `runtimeDir: ${runtimeDir} (mode ${formatMode(mode)} is not 0700; group/other access should be removed)`,
    };
  } catch (error) {
    if (isMissingPathError(error)) {
      return {
        needsRepair: true,
        detail: `runtimeDir: ${runtimeDir} (missing; will be created with mode 0700)`,
      };
    }
    // An unreadable dir is already a usability failure handled above; do not
    // double-report it here.
    return { needsRepair: false, detail: "" };
  }
}

function createEnsurePrivateDirFix(
  runtimeDir: string,
  ensureImpl?: (runtimeDir: string) => Promise<void>,
): DoctorFix {
  const ensure = ensureImpl ?? ((dir: string) => ensurePrivateRuntimeDir(dir));
  return {
    id: "runtime.ensure-private-dir",
    title: "create/repair runtime dir with mode 0700",
    run: async () => {
      await ensure(runtimeDir);
      return { ok: true, message: `runtime dir ${runtimeDir} created/repaired with mode 0700` };
    },
  };
}

function formatMode(mode: number): string {
  return `0${(mode & 0o777).toString(8)}`;
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
  /** POSIX permission bits, when the probe supplies them (used for privacy checks). */
  mode?: number;
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
