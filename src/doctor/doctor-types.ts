export type DoctorSeverity = "pass" | "warn" | "fail" | "skip";

export interface DoctorCheckResult {
  id: string;
  label: string;
  severity: DoctorSeverity;
  summary: string;
  details?: string[];
  suggestions?: string[];
  metadata?: Record<string, unknown>;
}

export interface DoctorRunOptions {
  verbose?: boolean;
  smoke?: boolean;
  agent?: string;
  workspace?: string;
}

export interface DoctorReport {
  checks: DoctorCheckResult[];
}
