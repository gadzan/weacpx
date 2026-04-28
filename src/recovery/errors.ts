export interface MissingOptionalDepPayload {
  package: string;
  parentPackagePath: string | null;
  rawMessage: string;
}

export class MissingOptionalDepError extends Error {
  readonly kind = "missing_optional_dep" as const;
  readonly package: string;
  readonly parentPackagePath: string | null;
  readonly rawMessage: string;
  constructor(payload: MissingOptionalDepPayload) {
    super(payload.rawMessage);
    this.name = "MissingOptionalDepError";
    this.package = payload.package;
    this.parentPackagePath = payload.parentPackagePath;
    this.rawMessage = payload.rawMessage;
  }
}

import type { PackageManager } from "./discover-parent-package-paths";

export interface AutoInstallStepError {
  scope: "precise" | "global";
  stderrTail: string;
  code: number | null;
  reason?: "timeout" | "spawn" | "exit" | "verify-failed";
  /** The parent package directory this precise install was run in (only set for scope === "precise"). */
  path?: string;
  /** The package manager used for this precise install (only set for scope === "precise"). */
  manager?: PackageManager;
}

export class AutoInstallFailedError extends Error {
  readonly kind = "auto_install_failed" as const;
  readonly original: MissingOptionalDepError;
  readonly steps: AutoInstallStepError[];
  readonly logPath: string;
  constructor(original: MissingOptionalDepError, steps: AutoInstallStepError[], logPath: string) {
    super(`auto-install failed: ${original.package}`);
    this.name = "AutoInstallFailedError";
    this.original = original;
    this.steps = steps;
    this.logPath = logPath;
  }
}
