import { resolveRuntimePaths, type RuntimePaths } from "../../main";
import { loadConfig } from "../../config/load-config";
import type { AppConfig } from "../../config/types";
import type { DoctorCheckResult } from "../doctor-types";

export interface ConfigCheckMetadata {
  configPath: string;
  config: AppConfig;
}

export interface ConfigCheckOptions {
  resolveRuntimePaths?: () => RuntimePaths;
  loadConfig?: typeof loadConfig;
}

export async function checkConfig(options: ConfigCheckOptions = {}): Promise<DoctorCheckResult> {
  const runtimePaths = (options.resolveRuntimePaths ?? resolveRuntimePaths)();
  const configPath = runtimePaths.configPath;

  try {
    const config = await (options.loadConfig ?? loadConfig)(configPath);
    return {
      id: "config",
      label: "Config",
      severity: "pass",
      summary: "configuration loaded",
      details: [`config path: ${configPath}`],
      metadata: {
        configPath,
        config,
      } satisfies ConfigCheckMetadata,
    };
  } catch (error) {
    return {
      id: "config",
      label: "Config",
      severity: "fail",
      summary: "configuration is invalid",
      details: [`config path: ${configPath}`, `error: ${formatError(error)}`],
    };
  }
}

function formatError(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }

  return String(error);
}
