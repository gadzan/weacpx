import { chmod, mkdir } from "node:fs/promises";

export interface EnsurePrivateRuntimeDirOptions {
  platform?: NodeJS.Platform;
  /** Best-effort chmod failures are reported here instead of thrown. */
  onChmodError?: (error: unknown) => void;
  chmodImpl?: (path: string, mode: number) => Promise<void>;
}

/**
 * Invariant: the runtime dir (~/.xacpx/runtime) is user-private (0700).
 *
 * It contains the orchestration unix socket (orchestration.sock), whose ONLY
 * access control is filesystem permissions — the RPC server itself performs no
 * authentication. mkdir's mode applies only when the directory is created, so
 * an explicit chmod repairs installs whose runtime dir predates this hardening.
 * The chmod is best-effort (POSIX only); on Windows the mode is ignored and
 * named pipes rely on the default DACL instead.
 */
export async function ensurePrivateRuntimeDir(
  runtimeDir: string,
  options: EnsurePrivateRuntimeDirOptions = {},
): Promise<void> {
  await mkdir(runtimeDir, { recursive: true, mode: 0o700 });

  const platform = options.platform ?? process.platform;
  if (platform === "win32") {
    return;
  }

  const chmodImpl = options.chmodImpl ?? chmod;
  try {
    await chmodImpl(runtimeDir, 0o700);
  } catch (error) {
    options.onChmodError?.(error);
  }
}
