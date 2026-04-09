import type { DoctorCheckResult, DoctorReport, DoctorRunOptions, DoctorSeverity } from "./doctor-types";

const SEVERITY_LABELS: Record<DoctorSeverity, string> = {
  pass: "PASS",
  warn: "WARN",
  fail: "FAIL",
  skip: "SKIP",
};

export function renderDoctor(report: DoctorReport, options: DoctorRunOptions = {}): string[] {
  return options.verbose ? renderVerboseDoctor(report) : renderDefaultDoctor(report);
}

function renderDefaultDoctor(report: DoctorReport): string[] {
  const lines: string[] = [];

  for (const check of report.checks) {
    lines.push(renderCheckLine(check));
  }

  lines.push(renderSummaryLine(report.checks));

  const suggestions = collectSuggestions(report.checks);
  if (suggestions.length > 0) {
    lines.push("Next steps:");
    for (const suggestion of suggestions) {
      lines.push(`- ${suggestion}`);
    }
  }

  return lines;
}

function renderVerboseDoctor(report: DoctorReport): string[] {
  const lines: string[] = [];

  for (const check of report.checks) {
    lines.push(renderCheckLine(check));
    for (const detail of check.details ?? []) {
      lines.push(`  detail: ${detail}`);
    }
  }

  lines.push(renderSummaryLine(report.checks));

  const suggestions = collectSuggestions(report.checks);
  if (suggestions.length > 0) {
    lines.push("Next steps:");
    for (const suggestion of suggestions) {
      lines.push(`- ${suggestion}`);
    }
  }

  return lines;
}

function renderCheckLine(check: DoctorCheckResult): string {
  return `${SEVERITY_LABELS[check.severity]} ${check.label}: ${check.summary}`;
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
