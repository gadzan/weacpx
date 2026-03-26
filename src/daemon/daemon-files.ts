import { join } from "node:path";

export interface DaemonPaths {
  runtimeDir: string;
  pidFile: string;
  statusFile: string;
  stdoutLog: string;
  stderrLog: string;
}

interface ResolveDaemonPathsOptions {
  home: string;
  runtimeDir?: string;
}

export function resolveDaemonPaths(options: ResolveDaemonPathsOptions): DaemonPaths {
  const runtimeDir = options.runtimeDir ?? join(options.home, ".weacpx", "runtime");

  return {
    runtimeDir,
    pidFile: join(runtimeDir, "daemon.pid"),
    statusFile: join(runtimeDir, "status.json"),
    stdoutLog: join(runtimeDir, "stdout.log"),
    stderrLog: join(runtimeDir, "stderr.log"),
  };
}
