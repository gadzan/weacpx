import { homedir } from "node:os";
import { join } from "node:path";

import { coreHomeDir } from "../runtime/core-home";
import { coreEnv } from "../runtime/core-env";
import { loadConfig } from "../config/load-config";
import type { AppConfig } from "../config/types";
import { resolveRuntimePaths, type RuntimePaths } from "../main";
import { StateStore, type StateLoadReport } from "../state/state-store";
import { checkAcpx } from "./checks/acpx-check";
import { checkBridge } from "./checks/bridge-check";
import { checkConfig } from "./checks/config-check";
import { checkDaemon } from "./checks/daemon-check";
import { checkOrchestrationHealth } from "./checks/orchestration-health";
import { checkRuntime } from "./checks/runtime-check";
import { checkSmoke } from "./checks/smoke-check";
import { checkWechat } from "./checks/wechat-check";
import type { DoctorCheckResult, DoctorReport, DoctorRunOptions } from "./doctor-types";
import { renderDoctor } from "./render-doctor";

export interface DoctorRunResult {
  report: DoctorReport;
  output: string[];
  exitCode: number;
}

interface DoctorDeps {
  home?: string;
  resolveRuntimePaths?: () => RuntimePaths;
  loadConfig?: (configPath: string) => Promise<AppConfig>;
  checkConfig?: typeof checkConfig;
  checkRuntime?: typeof checkRuntime;
  checkDaemon?: typeof checkDaemon;
  checkWechat?: typeof checkWechat;
  checkAcpx?: typeof checkAcpx;
  checkBridge?: typeof checkBridge;
  checkOrchestrationHealth?: () => Promise<DoctorCheckResult>;
  checkSmoke?: (options: DoctorRunOptions) => Promise<DoctorCheckResult>;
  renderDoctor?: typeof renderDoctor;
}

export async function runDoctor(options: DoctorRunOptions = {}, deps: DoctorDeps = {}): Promise<DoctorRunResult> {
  const home = deps.home ?? process.env.HOME ?? homedir();
  const runtimePaths = resolveDoctorRuntimePaths(home, deps.resolveRuntimePaths);
  const sharedLoadConfig = createSharedLoadConfig(runtimePaths, deps.loadConfig ?? loadConfig);

  const checks: DoctorCheckResult[] = [];
  checks.push(
    await (deps.checkConfig ?? checkConfig)({
      loadConfig: sharedLoadConfig,
      resolveRuntimePaths: () => runtimePaths,
    }),
  );
  checks.push(
    await (deps.checkRuntime ?? checkRuntime)({
      home,
      configPath: runtimePaths.configPath,
    }),
  );
  checks.push(
    await (deps.checkDaemon ?? checkDaemon)({
      home,
      configPath: runtimePaths.configPath,
    }),
  );
  checks.push(
    await (deps.checkWechat ?? checkWechat)({
      verbose: options.verbose,
    }),
  );
  checks.push(
    await (deps.checkAcpx ?? checkAcpx)({
      verbose: options.verbose,
      loadConfig: sharedLoadConfig,
      resolveRuntimePaths: () => runtimePaths,
    }),
  );
  checks.push(
    await (deps.checkBridge ?? checkBridge)({
      verbose: options.verbose,
      loadConfig: sharedLoadConfig,
      resolveRuntimePaths: () => runtimePaths,
    }),
  );
  checks.push(
    await (deps.checkOrchestrationHealth ?? (() => defaultCheckOrchestrationHealth({
      runtimePaths,
      loadConfig: sharedLoadConfig,
    })))(),
  );
  checks.push(
    options.smoke === true
      ? await (deps.checkSmoke ?? ((runOptions) => defaultCheckSmoke(runOptions, {
          resolveRuntimePaths: () => runtimePaths,
          loadConfig: sharedLoadConfig,
        })))(options)
      : createSmokeSkipResult("smoke probe not requested"),
  );

  const report: DoctorReport = { checks };
  const output = (deps.renderDoctor ?? renderDoctor)(report, options);

  return {
    report,
    output,
    exitCode: checks.some((check) => check.severity === "fail") ? 1 : 0,
  };
}

function resolveDoctorRuntimePaths(home: string, resolver?: () => RuntimePaths): RuntimePaths {
  if (resolver) {
    return resolver();
  }

  if (depsUseExplicitRuntimeOverrides()) {
    return resolveRuntimePaths();
  }

  return {
    configPath: join(coreHomeDir(home), "config.json"),
    statePath: join(coreHomeDir(home), "state.json"),
  };
}

function depsUseExplicitRuntimeOverrides(): boolean {
  return Boolean(coreEnv("CONFIG") || coreEnv("STATE"));
}

function createSharedLoadConfig(
  runtimePaths: RuntimePaths,
  loader: (configPath: string) => Promise<AppConfig>,
): (configPath: string) => Promise<AppConfig> {
  let pending: Promise<AppConfig> | undefined;

  return async (configPath: string) => {
    if (configPath !== runtimePaths.configPath) {
      return await loader(configPath);
    }

    pending ??= loader(configPath);
    return await pending;
  };
}

async function defaultCheckSmoke(options: DoctorRunOptions, deps: {
  resolveRuntimePaths: () => RuntimePaths;
  loadConfig: (configPath: string) => Promise<AppConfig>;
}): Promise<DoctorCheckResult> {
  return await checkSmoke(options, {
    resolveRuntimePaths: deps.resolveRuntimePaths,
    loadConfig: deps.loadConfig,
  });
}

function createSmokeSkipResult(summary: string): DoctorCheckResult {
  return {
    id: "smoke",
    label: "Smoke",
    severity: "skip",
    summary,
  };
}

async function defaultCheckOrchestrationHealth(deps: {
  runtimePaths: RuntimePaths;
  loadConfig: (configPath: string) => Promise<AppConfig>;
}): Promise<DoctorCheckResult> {
  let config: AppConfig;
  try {
    config = await deps.loadConfig(deps.runtimePaths.configPath);
  } catch (error) {
    return {
      id: "orchestration",
      label: "Orchestration",
      severity: "skip",
      summary: "orchestration check skipped because configuration could not be loaded",
      details: [`config path: ${deps.runtimePaths.configPath}`, `error: ${formatError(error)}`],
      suggestions: ["fix the Config check first, then run: xacpx doctor"],
    };
  }

  try {
    // inspect(), not load(): a diagnostic command must never quarantine/rename
    // state.json as a side effect. The inspection report is surfaced below so
    // damage the daemon WOULD repair at startup is visible, not masked.
    const store = new StateStore(deps.runtimePaths.statePath);
    const inspection = await store.inspect();
    const result = await checkOrchestrationHealth({
      loadState: async () => inspection.state,
      now: () => new Date(),
      heartbeatThresholdSeconds: config.orchestration.progressHeartbeatSeconds,
    });
    return applyStateInspectionReport(result, inspection.report, deps.runtimePaths.statePath);
  } catch (error) {
    return {
      id: "orchestration",
      label: "Orchestration",
      severity: "fail",
      summary: "orchestration health check failed",
      details: [`state path: ${deps.runtimePaths.statePath}`, `error: ${formatError(error)}`],
    };
  }
}

/**
 * Merge a state.json inspection report into the orchestration check result.
 * Severity follows the doctor convention for degraded-but-working conditions
 * (daemon stopped / wechat logged out are "warn"): the daemon still boots —
 * it quarantines the listed records at startup — so this warns rather than
 * fails, and never downgrades an existing "fail".
 */
function applyStateInspectionReport(
  result: DoctorCheckResult,
  report: StateLoadReport | null,
  statePath: string,
): DoctorCheckResult {
  if (!report) {
    return result;
  }

  const fileCorrupt = report.dropped.some((record) => record.section === "file");
  const details = [
    ...(result.details ?? []),
    `state path: ${statePath}`,
    ...report.dropped.map((record) =>
      record.section === "file"
        ? `state.json is unreadable: ${record.reason}`
        : `invalid state record ${record.section}["${record.key}"]: ${record.reason}`,
    ),
  ];

  return {
    ...result,
    severity: result.severity === "fail" ? "fail" : "warn",
    summary: fileCorrupt
      ? `state.json is unreadable and will be reset (renamed to state.json.corrupt-*) at next daemon startup; ${result.summary}`
      : `state.json has ${report.dropped.length} invalid record(s) that will be quarantined at next daemon startup; ${result.summary}`,
    details,
    suggestions: [
      ...(result.suggestions ?? []),
      fileCorrupt
        ? "back up the state file before the next daemon start if you want to attempt manual recovery"
        : "the daemon backs the original file up as state.json.quarantine-* before dropping these records",
    ],
  };
}

function formatError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
