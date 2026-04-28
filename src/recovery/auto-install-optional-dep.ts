// src/recovery/auto-install-optional-dep.ts
import { spawn } from "node:child_process";
import { createWriteStream, type WriteStream } from "node:fs";
import { mkdir } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import type { AutoInstallStepError } from "./errors";
import type { DiscoveredParentPath, PackageManager } from "./discover-parent-package-paths";

export interface AutoInstallResult {
  ok: boolean;
  errors: AutoInstallStepError[];
  logPath: string;
}

export interface CliRunResult {
  code: number;
  stdout: string;
  stderr: string;
  reason?: "timeout" | "spawn" | "exit";
}

export type CliRunner = (
  cmd: string,
  args: string[],
  options: { cwd?: string; timeoutMs: number },
) => Promise<CliRunResult>;

export interface AutoInstallLogSink {
  path: string;
  append: (chunk: string) => Promise<void>;
  close: () => Promise<void>;
}

export type LogSinkFactory = () => Promise<AutoInstallLogSink>;

export interface AutoInstallOptions {
  runCli?: CliRunner;
  openLog?: LogSinkFactory;
  /**
   * Called after each successful install step. Return true if the session can now start,
   * false to continue trying remaining install scopes. If omitted, any successful install
   * exits immediately with ok:true.
   */
  verify?: () => Promise<boolean>;
}

const PRECISE_TIMEOUT_MS = 90_000;
const GLOBAL_TIMEOUT_MS = 90_000;
const TAIL_LINES = 10;

interface InstallSpec {
  cmd: string;
  args: (pkg: string) => string[];
}

// Per-manager precise install: run inside the parent package's directory.
// Each PM manages its own store; running the wrong CLI inside another PM's tree
// corrupts lockfiles and layout, so we dispatch by the tagged manager.
const PRECISE_COMMANDS: Record<PackageManager, InstallSpec> = {
  npm: { cmd: "npm", args: (pkg) => ["install", pkg, "--no-save", "--no-audit", "--no-fund"] },
  bun: { cmd: "bun", args: (pkg) => ["add", pkg] },
  pnpm: { cmd: "pnpm", args: (pkg) => ["add", pkg] },
  yarn: { cmd: "yarn", args: (pkg) => ["add", pkg] },
};

export async function autoInstallOptionalDep(
  pkg: string,
  parentPackages: DiscoveredParentPath[],
  options: AutoInstallOptions = {},
): Promise<AutoInstallResult> {
  const runCli = options.runCli ?? defaultRunCli;
  const openLog = options.openLog ?? defaultLogSink;
  const verify = options.verify;
  const log = await openLog();
  const errors: AutoInstallStepError[] = [];

  try {
    for (const candidate of parentPackages) {
      const spec = PRECISE_COMMANDS[candidate.manager];
      const args = spec.args(pkg);
      await log.append(`$ ${spec.cmd} ${args.join(" ")} (cwd=${candidate.path})\n`);
      const precise = await runCli(spec.cmd, args, {
        cwd: candidate.path,
        timeoutMs: PRECISE_TIMEOUT_MS,
      });
      await log.append(`${precise.stdout}\n${precise.stderr}\n`);
      if (precise.code === 0) {
        if (!verify || (await verify())) {
          return { ok: true, errors, logPath: log.path };
        }
        errors.push({
          scope: "precise",
          stderrTail: "",
          code: 0,
          reason: "verify-failed",
          path: candidate.path,
          manager: candidate.manager,
        });
        await log.append(`precise install exit=0 but verification failed at ${candidate.path}; trying next scope\n`);
      } else {
        errors.push({
          scope: "precise",
          stderrTail: tail(precise.stderr, TAIL_LINES),
          code: precise.code,
          reason: precise.reason ?? "exit",
          path: candidate.path,
          manager: candidate.manager,
        });
      }
    }

    // Global fallback: always npm. Users without npm are rare, and mapping
    // "which global to install into" across PMs is ambiguous — npm -g is the
    // universally understood recovery path for the manual instructions we print.
    await log.append(`$ npm install -g ${pkg} --no-audit --no-fund\n`);
    const globalResult = await runCli(
      "npm",
      ["install", "-g", pkg, "--no-audit", "--no-fund"],
      { timeoutMs: GLOBAL_TIMEOUT_MS },
    );
    await log.append(`${globalResult.stdout}\n${globalResult.stderr}\n`);
    if (globalResult.code === 0) {
      if (!verify || (await verify())) {
        return { ok: true, errors, logPath: log.path };
      }
      errors.push({ scope: "global", stderrTail: "", code: 0, reason: "verify-failed" });
      await log.append(`global install exit=0 but verification failed\n`);
      return { ok: false, errors, logPath: log.path };
    }
    errors.push({
      scope: "global",
      stderrTail: tail(globalResult.stderr, TAIL_LINES),
      code: globalResult.code,
      reason: globalResult.reason ?? "exit",
    });
    return { ok: false, errors, logPath: log.path };
  } finally {
    await log.close();
  }
}

function tail(text: string, lines: number): string {
  const all = text.split("\n");
  return all.slice(Math.max(0, all.length - lines)).join("\n");
}

const defaultRunCli: CliRunner = async (cmd, args, options) => {
  return await new Promise<CliRunResult>((resolve) => {
    const child = spawn(cmd, args, {
      cwd: options.cwd,
      stdio: ["ignore", "pipe", "pipe"],
      shell: process.platform === "win32",
    });
    let stdout = "";
    let stderr = "";
    let timedOut = false;

    const timer = setTimeout(() => {
      timedOut = true;
      child.kill("SIGTERM");
      setTimeout(() => child.kill("SIGKILL"), 3000).unref();
    }, options.timeoutMs);
    timer.unref();

    child.stdout.on("data", (chunk) => { stdout += String(chunk); });
    child.stderr.on("data", (chunk) => { stderr += String(chunk); });
    child.on("error", (err) => {
      clearTimeout(timer);
      resolve({ code: 1, stdout, stderr: `${stderr}\n${err.message}`, reason: "spawn" });
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      resolve({
        code: code ?? 1,
        stdout,
        stderr,
        reason: timedOut ? "timeout" : "exit",
      });
    });
  });
};

const defaultLogSink: LogSinkFactory = async () => {
  const dir = join(homedir(), ".weacpx", "logs");
  await mkdir(dir, { recursive: true });
  const timestamp = new Date().toISOString().replace(/[:.]/g, "").replace(/-/g, "");
  const path = join(dir, `auto-install-${timestamp}.log`);
  const stream: WriteStream = createWriteStream(path, { flags: "a" });
  return {
    path,
    append: async (chunk: string) => {
      await new Promise<void>((resolve, reject) =>
        stream.write(chunk, (err) => (err ? reject(err) : resolve())),
      );
    },
    close: async () => {
      await new Promise<void>((resolve) => stream.end(() => resolve()));
    },
  };
};
