import type { DoctorCheckResult, DoctorReport, DoctorRunOptions, DoctorSeverity } from "./doctor-types";

const SEVERITY_LABELS: Record<DoctorSeverity, string> = {
  pass: "PASS",
  warn: "WARN",
  fail: "FAIL",
  skip: "SKIP",
};

export function renderDoctor(report: DoctorReport, options: DoctorRunOptions = {}): string[] {
  const fixMode = options.fix === true;
  return options.verbose
    ? renderVerboseDoctor(report, fixMode)
    : renderDefaultDoctor(report, fixMode);
}

function renderDefaultDoctor(report: DoctorReport, fixMode: boolean): string[] {
  const lines: string[] = [];

  for (const check of report.checks) {
    lines.push(renderCheckLine(check, fixMode));
  }

  appendRepairs(lines, report, fixMode);
  lines.push(renderSummaryLine(report.checks));
  appendNextSteps(lines, report.checks);

  return lines;
}

function renderVerboseDoctor(report: DoctorReport, fixMode: boolean): string[] {
  const lines: string[] = [];

  for (const check of report.checks) {
    lines.push(renderCheckLine(check, fixMode));
    for (const detail of check.details ?? []) {
      lines.push(`  detail: ${detail}`);
    }
  }

  appendRepairs(lines, report, fixMode);
  lines.push(renderSummaryLine(report.checks));
  appendNextSteps(lines, report.checks);

  return lines;
}

function appendNextSteps(lines: string[], checks: DoctorCheckResult[]): void {
  const suggestions = collectSuggestions(checks);
  if (suggestions.length > 0) {
    lines.push("Next steps:");
    for (const suggestion of suggestions) {
      lines.push(`- ${suggestion}`);
    }
  }
}

function appendRepairs(lines: string[], report: DoctorReport, fixMode: boolean): void {
  if (!fixMode) {
    return;
  }

  const repairs = report.repairs ?? [];
  if (repairs.length === 0) {
    return;
  }

  lines.push("Repairs:");
  for (const repair of repairs) {
    lines.push(`- ${repair.title}: ${repair.status} (${repair.message})`);
  }
}

function renderCheckLine(check: DoctorCheckResult, fixMode: boolean): string {
  const base = `${SEVERITY_LABELS[check.severity]} ${check.label}: ${check.summary}`;
  if (!fixMode && (check.fixes?.length ?? 0) > 0) {
    return `${base} (fixable — run: xacpx doctor --fix)`;
  }
  return base;
}

function renderSummaryLine(checks: DoctorCheckResult[]): string {
  const counts = summarizeChecks(checks);
  return `Summary: PASS ${counts.pass}, WARN ${counts.warn}, FAIL ${counts.fail}, SKIP ${counts.skip}`;
}

function summarizeChecks(checks: DoctorCheckResult[]): Record<DoctorSeverity, number> {
  return checks.reduce(
    (counts, check) => {
      counts[check.severity] += 1;
      return counts;
    },
    { pass: 0, warn: 0, fail: 0, skip: 0 } as Record<DoctorSeverity, number>,
  );
}

function collectSuggestions(checks: DoctorCheckResult[]): string[] {
  const seen = new Set<string>();
  const suggestions: string[] = [];

  for (const check of checks) {
    for (const suggestion of check.suggestions ?? []) {
      if (seen.has(suggestion)) {
        continue;
      }

      seen.add(suggestion);
      suggestions.push(suggestion);
    }
  }

  return suggestions;
}
