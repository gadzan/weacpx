import { homedir } from "node:os";
import { join } from "node:path";

import { loadConfig } from "../config/load-config";
import type { AppConfig } from "../config/types";
import { resolveRuntimePaths, type RuntimePaths } from "../main";
import { StateStore } from "../state/state-store";
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
    }),
  );
  checks.push(
    await (deps.checkDaemon ?? checkDaemon)({
      home,
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
    configPath: join(home, ".weacpx", "config.json"),
    statePath: join(home, ".weacpx", "state.json"),
  };
}

function depsUseExplicitRuntimeOverrides(): boolean {
  return Boolean(process.env.WEACPX_CONFIG || process.env.WEACPX_STATE);
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
      suggestions: ["fix the Config check first, then run: weacpx doctor"],
    };
  }

  try {
    const store = new StateStore(deps.runtimePaths.statePath);
    return await checkOrchestrationHealth({
      loadState: () => store.load(),
      now: () => new Date(),
      heartbeatThresholdSeconds: config.orchestration.progressHeartbeatSeconds,
    });
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

function formatError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
