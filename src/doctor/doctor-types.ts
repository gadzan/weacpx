export type DoctorSeverity = "pass" | "warn" | "fail" | "skip";

export interface DoctorFixOutcome {
  ok: boolean;
  message: string;
}

export interface DoctorFix {
  /** Stable identifier, e.g. "runtime.repair-perms". */
  id: string;
  /** Human-readable title, e.g. "create runtime dir with mode 0700". */
  title: string;
  /** When set, the fix is NOT run under --fix; this reason is rendered instead. */
  withheld?: string;
  run: () => Promise<DoctorFixOutcome>;
}

export interface DoctorCheckResult {
  id: string;
  label: string;
  severity: DoctorSeverity;
  summary: string;
  details?: string[];
  suggestions?: string[];
  metadata?: Record<string, unknown>;
  fixes?: DoctorFix[];
}

export interface DoctorRunOptions {
  verbose?: boolean;
  smoke?: boolean;
  agent?: string;
  workspace?: string;
  fix?: boolean;
}

export interface DoctorRepairOutcome {
  checkId: string;
  fixId: string;
  title: string;
  status: "applied" | "failed" | "skipped";
  /** Outcome message, or the withheld reason for a skipped fix. */
  message: string;
}

export interface DoctorReport {
  checks: DoctorCheckResult[];
  repairs?: DoctorRepairOutcome[];
}
