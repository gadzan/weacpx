import { expect, test } from "bun:test";

import { BridgeRuntime } from "../../../src/bridge/bridge-runtime";
import type { EnsureSessionProgress } from "../../../src/transport/acpx-bridge/acpx-bridge-protocol";

test("ensureSession passes --verbose and forwards stderr lines as note events", async () => {
  const events: EnsureSessionProgress[] = [];
  const allArgs: string[][] = [];
  const runtime = new BridgeRuntime(
    "acpx",
    async (_cmd, args, options) => {
      allArgs.push(args);
      if (args.includes("ensure")) {
        // Emulate acpx streaming two stderr lines then exiting 0.
        options?.onStderrLine?.("[acpx] spawning installed built-in agent opencode@0.1.2 via npx opencode");
        options?.onStderrLine?.("[acpx] downloading package tarball");
      }
      return { code: 0, stdout: "", stderr: "" };
    },
  );

  await runtime.ensureSession(
    { agent: "opencode", cwd: "/repo", name: "demo" },
    (progress) => events.push(progress),
  );

  const ensureArgs = allArgs.find((a) => a.includes("ensure"));
  expect(ensureArgs).toBeDefined();
  expect(ensureArgs).toContain("--verbose");
  expect(events[0]).toBe("spawn");
  expect(events).toContainEqual({
    kind: "note",
    text: "[acpx] spawning installed built-in agent opencode@0.1.2 via npx opencode",
  });
  expect(events).toContainEqual({
    kind: "note",
    text: "[acpx] downloading package tarball",
  });
  expect(events.at(-1)).toBe("ready");
});

test("ensureSession retries without --verbose if acpx rejects the option", async () => {
  const calls: string[][] = [];
  const runtime = new BridgeRuntime(
    "acpx",
    async (_cmd, args) => {
      calls.push(args);
      if (args.includes("--verbose")) {
        return { code: 1, stdout: "", stderr: "error: unknown option '--verbose'" };
      }
      return { code: 0, stdout: "", stderr: "" };
    },
  );

  await runtime.ensureSession({ agent: "opencode", cwd: "/repo", name: "demo" });

  expect(calls).toHaveLength(2);
  expect(calls[0]).toContain("--verbose");
  expect(calls[1]).not.toContain("--verbose");

  // Subsequent ensureSession should skip --verbose entirely (cached result).
  const calls2: string[][] = [];
  const cached = runtime as unknown as {
    run: (c: string, a: string[]) => Promise<{ code: number; stdout: string; stderr: string }>;
  };
  const orig = cached.run;
  cached.run = async (c, a) => {
    calls2.push(a);
    return await orig.call(cached, c, a);
  };
  await runtime.ensureSession({ agent: "opencode", cwd: "/repo", name: "demo2" });
  expect(calls2.every((a) => !a.includes("--verbose"))).toBe(true);
});

test("ensureSession streams stderr lines from runSessionCreate fallback with --verbose", async () => {
  const events: EnsureSessionProgress[] = [];
  let createArgs: string[] = [];
  const runtime = new BridgeRuntime(
    "acpx",
    async (_cmd, args) => {
      if (args.includes("ensure")) return { code: 1, stdout: "", stderr: "" };
      return { code: 1, stdout: "", stderr: "" }; // show
    },
    async (_cmd, args, _cwd, options) => {
      createArgs = args;
      options?.onStderrLine?.("[acpx] spawning agent: npx opencode");
      return { code: 0, stdout: "", stderr: "" };
    },
  );

  await runtime.ensureSession(
    { agent: "opencode", cwd: "/repo", name: "demo" },
    (p) => events.push(p),
  );

  expect(createArgs).toContain("--verbose");
  expect(events).toContainEqual({ kind: "note", text: "[acpx] spawning agent: npx opencode" });
});
