// tests/unit/recovery/auto-install-optional-dep.test.ts
import { describe, expect, test, mock } from "bun:test";
import { autoInstallOptionalDep } from "../../../src/recovery/auto-install-optional-dep";
import type { DiscoveredParentPath } from "../../../src/recovery/discover-parent-package-paths";

function fakeSpawn(exitCode: number, stderr = "") {
  return mock(async () => ({ code: exitCode, stdout: "", stderr }));
}

const npmAt = (path: string): DiscoveredParentPath => ({ path, manager: "npm" });
const bunAt = (path: string): DiscoveredParentPath => ({ path, manager: "bun" });
const pnpmAt = (path: string): DiscoveredParentPath => ({ path, manager: "pnpm" });

describe("autoInstallOptionalDep", () => {
  test("precise install for npm tree dispatches npm install, global is not called", async () => {
    const runCli = fakeSpawn(0);
    const result = await autoInstallOptionalDep("opencode-windows-x64", [npmAt("/path/opencode")], {
      runCli,
      openLog: async () => ({ path: "/log", append: async () => {}, close: async () => {} }),
    });
    expect(result.ok).toBe(true);
    expect(runCli.mock.calls).toHaveLength(1);
    expect(runCli.mock.calls[0][0]).toBe("npm");
    expect(runCli.mock.calls[0][1]).toEqual(["install", "opencode-windows-x64", "--no-save", "--no-audit", "--no-fund"]);
    expect(runCli.mock.calls[0][2]).toEqual({ cwd: "/path/opencode", timeoutMs: 90_000 });
  });

  test("precise install for bun tree dispatches `bun add`", async () => {
    const runCli = fakeSpawn(0);
    const result = await autoInstallOptionalDep("opencode-windows-x64", [bunAt("/bun/opencode")], {
      runCli,
      openLog: async () => ({ path: "/log", append: async () => {}, close: async () => {} }),
    });
    expect(result.ok).toBe(true);
    expect(runCli.mock.calls[0][0]).toBe("bun");
    expect(runCli.mock.calls[0][1]).toEqual(["add", "opencode-windows-x64"]);
  });

  test("precise install for pnpm tree dispatches `pnpm add`", async () => {
    const runCli = fakeSpawn(0);
    const result = await autoInstallOptionalDep("opencode-windows-x64", [pnpmAt("/pnpm/opencode")], {
      runCli,
      openLog: async () => ({ path: "/log", append: async () => {}, close: async () => {} }),
    });
    expect(result.ok).toBe(true);
    expect(runCli.mock.calls[0][0]).toBe("pnpm");
    expect(runCli.mock.calls[0][1]).toEqual(["add", "opencode-windows-x64"]);
  });

  test("precise fails then global succeeds", async () => {
    let call = 0;
    const runCli = mock(async () => (call++ === 0
      ? { code: 1, stdout: "", stderr: "npm ERR! 403" }
      : { code: 0, stdout: "", stderr: "" }
    ));
    const result = await autoInstallOptionalDep("opencode-windows-x64", [npmAt("/path/opencode")], {
      runCli,
      openLog: async () => ({ path: "/log", append: async () => {}, close: async () => {} }),
    });
    expect(result.ok).toBe(true);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0].scope).toBe("precise");
    expect(result.errors[0].path).toBe("/path/opencode");
    expect(result.errors[0].manager).toBe("npm");
  });

  test("both fail — global always uses npm", async () => {
    const runCli = mock(async () => ({ code: 1, stdout: "", stderr: "boom" }));
    const result = await autoInstallOptionalDep("opencode-windows-x64", [bunAt("/bun/opencode")], {
      runCli,
      openLog: async () => ({ path: "/log", append: async () => {}, close: async () => {} }),
    });
    expect(result.ok).toBe(false);
    expect(result.errors).toHaveLength(2);
    expect(result.errors.map((e) => e.scope)).toEqual(["precise", "global"]);
    // Last call is the global fallback, always using npm.
    expect(runCli.mock.calls[1][0]).toBe("npm");
    expect(runCli.mock.calls[1][1]).toEqual(["install", "-g", "opencode-windows-x64", "--no-audit", "--no-fund"]);
  });

  test("empty parentPackages skips precise step and goes straight to global npm install", async () => {
    const runCli = fakeSpawn(0);
    const result = await autoInstallOptionalDep("opencode-windows-x64", [], {
      runCli,
      openLog: async () => ({ path: "/log", append: async () => {}, close: async () => {} }),
    });
    expect(result.ok).toBe(true);
    expect(runCli.mock.calls).toHaveLength(1);
    expect(runCli.mock.calls[0][0]).toBe("npm");
    expect(runCli.mock.calls[0][1]).toContain("-g");
  });

  test("iterates multiple parent paths with mixed managers until one verifies", async () => {
    const runCli = fakeSpawn(0);
    const verifyResults = [false, false, true];
    let verifyIdx = 0;
    const result = await autoInstallOptionalDep(
      "opencode-windows-x64",
      [bunAt("/path/bun"), npmAt("/path/npm"), pnpmAt("/path/pnpm")],
      {
        runCli,
        openLog: async () => ({ path: "/log", append: async () => {}, close: async () => {} }),
        verify: async () => verifyResults[verifyIdx++]!,
      },
    );
    expect(result.ok).toBe(true);
    expect(runCli.mock.calls).toHaveLength(3);
    // Per-manager CLI dispatch — each call uses the right binary.
    expect(runCli.mock.calls[0][0]).toBe("bun");
    expect(runCli.mock.calls[1][0]).toBe("npm");
    expect(runCli.mock.calls[2][0]).toBe("pnpm");
    expect(result.errors).toHaveLength(2);
    expect(result.errors[0]).toMatchObject({
      scope: "precise",
      reason: "verify-failed",
      path: "/path/bun",
      manager: "bun",
    });
    expect(result.errors[1]).toMatchObject({
      scope: "precise",
      reason: "verify-failed",
      path: "/path/npm",
      manager: "npm",
    });
  });

  test("falls back to global install when every precise path verify-fails", async () => {
    const runCli = fakeSpawn(0);
    const result = await autoInstallOptionalDep(
      "opencode-windows-x64",
      [bunAt("/path/bun"), npmAt("/path/npm")],
      {
        runCli,
        openLog: async () => ({ path: "/log", append: async () => {}, close: async () => {} }),
        verify: async () => false,
      },
    );
    expect(result.ok).toBe(false);
    expect(runCli.mock.calls).toHaveLength(3);
    expect(result.errors).toHaveLength(3);
    expect(result.errors.map((e) => e.scope)).toEqual(["precise", "precise", "global"]);
    expect(result.errors.every((e) => e.reason === "verify-failed")).toBe(true);
  });

  test("stderrTail keeps only last 10 lines", async () => {
    const manyLines = Array.from({ length: 50 }, (_, i) => `line ${i}`).join("\n");
    const runCli = fakeSpawn(1, manyLines);
    const result = await autoInstallOptionalDep("x", [npmAt("/p")], {
      runCli,
      openLog: async () => ({ path: "/log", append: async () => {}, close: async () => {} }),
    });
    expect(result.errors[0].stderrTail.split("\n").length).toBeLessThanOrEqual(10);
    expect(result.errors[0].stderrTail).toContain("line 49");
  });
});
