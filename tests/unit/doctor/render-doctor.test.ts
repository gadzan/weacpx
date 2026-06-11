import { expect, test } from "bun:test";

import { renderDoctor } from "../../../src/doctor/render-doctor";
import type { DoctorReport } from "../../../src/doctor/doctor-types";

test("renders the full default checklist and summary", () => {
  const report: DoctorReport = {
    checks: [
      {
        id: "config",
        label: "Config",
        severity: "pass",
        summary: "configuration file found",
      },
      {
        id: "daemon",
        label: "Daemon",
        severity: "warn",
        summary: "daemon metadata is missing",
        suggestions: ["Restart the daemon", "Recreate the runtime metadata"],
      },
      {
        id: "acpx",
        label: "Acpx",
        severity: "fail",
        summary: "acpx is not available",
        suggestions: ["Install acpx", "Restart the daemon"],
      },
      {
        id: "smoke",
        label: "Smoke",
        severity: "skip",
        summary: "smoke check not requested",
      },
    ],
  };

  expect(renderDoctor(report)).toEqual([
    "PASS Config: configuration file found",
    "WARN Daemon: daemon metadata is missing",
    "FAIL Acpx: acpx is not available",
    "SKIP Smoke: smoke check not requested",
    "Summary: PASS 1, WARN 1, FAIL 1, SKIP 1",
    "Next steps:",
    "- Restart the daemon",
    "- Recreate the runtime metadata",
    "- Install acpx",
  ]);
});

test("omits next steps when no suggestions are present", () => {
  const report: DoctorReport = {
    checks: [
      {
        id: "config",
        label: "Config",
        severity: "pass",
        summary: "configuration file found",
      },
    ],
  };

  expect(renderDoctor(report)).toEqual([
    "PASS Config: configuration file found",
    "Summary: PASS 1, WARN 0, FAIL 0, SKIP 0",
  ]);
});

test("keeps suggestion ordering stable while deduplicating repeats", () => {
  const report: DoctorReport = {
    checks: [
      {
        id: "first",
        label: "First",
        severity: "warn",
        summary: "first warning",
        suggestions: ["Alpha", "Beta", "Alpha"],
      },
      {
        id: "second",
        label: "Second",
        severity: "fail",
        summary: "second failure",
        suggestions: ["Beta", "Gamma"],
      },
    ],
  };

  expect(renderDoctor(report)).toEqual([
    "WARN First: first warning",
    "FAIL Second: second failure",
    "Summary: PASS 0, WARN 1, FAIL 1, SKIP 0",
    "Next steps:",
    "- Alpha",
    "- Beta",
    "- Gamma",
  ]);
});

test("marks fixable checks without --fix", () => {
  const report: DoctorReport = {
    checks: [
      {
        id: "runtime",
        label: "Runtime",
        severity: "fail",
        summary: "runtime dir is not private",
        fixes: [
          {
            id: "runtime.repair",
            title: "repair runtime perms",
            run: async () => ({ ok: true, message: "done" }),
          },
        ],
      },
    ],
  };

  expect(renderDoctor(report)).toEqual([
    "FAIL Runtime: runtime dir is not private (fixable — run: xacpx doctor --fix)",
    "Summary: PASS 0, WARN 0, FAIL 1, SKIP 0",
  ]);
});

test("renders the repairs section under --fix", () => {
  const report: DoctorReport = {
    checks: [
      {
        id: "runtime",
        label: "Runtime",
        severity: "pass",
        summary: "runtime dir is private",
      },
    ],
    repairs: [
      {
        checkId: "runtime",
        fixId: "runtime.repair",
        title: "repair runtime perms",
        status: "applied",
        message: "created runtime dir",
      },
      {
        checkId: "daemon",
        fixId: "daemon.clear",
        title: "clear stale runtime",
        status: "skipped",
        message: "stop the daemon first",
      },
      {
        checkId: "orchestration",
        fixId: "state.quarantine",
        title: "quarantine state",
        status: "failed",
        message: "permission denied",
      },
    ],
  };

  expect(renderDoctor(report, { fix: true })).toEqual([
    "PASS Runtime: runtime dir is private",
    "Repairs:",
    "- repair runtime perms: applied (created runtime dir)",
    "- clear stale runtime: skipped (stop the daemon first)",
    "- quarantine state: failed (permission denied)",
    "Summary: PASS 1, WARN 0, FAIL 0, SKIP 0",
  ]);
});

test("omits the repairs section under --fix when there were no repairs", () => {
  const report: DoctorReport = {
    checks: [
      {
        id: "config",
        label: "Config",
        severity: "pass",
        summary: "configuration file found",
      },
    ],
    repairs: [],
  };

  expect(renderDoctor(report, { fix: true })).toEqual([
    "PASS Config: configuration file found",
    "Summary: PASS 1, WARN 0, FAIL 0, SKIP 0",
  ]);
});

test("includes detail lines in verbose mode", () => {
  const report: DoctorReport = {
    checks: [
      {
        id: "daemon",
        label: "Daemon",
        severity: "warn",
        summary: "daemon metadata is missing",
        details: ["config path: /tmp/weacpx", "pid path: missing"],
      },
    ],
  };

  expect(renderDoctor(report, { verbose: true })).toEqual([
    "WARN Daemon: daemon metadata is missing",
    "  detail: config path: /tmp/weacpx",
    "  detail: pid path: missing",
    "Summary: PASS 0, WARN 1, FAIL 0, SKIP 0",
  ]);
});
