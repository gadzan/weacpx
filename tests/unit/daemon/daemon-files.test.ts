import { expect, test } from "bun:test";

import { resolveDaemonPaths } from "../../../src/daemon/daemon-files";

test("resolves runtime files under ~/.weacpx/runtime by default", () => {
  expect(
    resolveDaemonPaths({
      home: "/Users/tester",
    }),
  ).toEqual({
    runtimeDir: "/Users/tester/.weacpx/runtime",
    pidFile: "/Users/tester/.weacpx/runtime/daemon.pid",
    statusFile: "/Users/tester/.weacpx/runtime/status.json",
    stdoutLog: "/Users/tester/.weacpx/runtime/stdout.log",
    stderrLog: "/Users/tester/.weacpx/runtime/stderr.log",
  });
});

test("allows overriding the runtime directory", () => {
  expect(
    resolveDaemonPaths({
      home: "/Users/tester",
      runtimeDir: "/tmp/weacpx-runtime",
    }),
  ).toEqual({
    runtimeDir: "/tmp/weacpx-runtime",
    pidFile: "/tmp/weacpx-runtime/daemon.pid",
    statusFile: "/tmp/weacpx-runtime/status.json",
    stdoutLog: "/tmp/weacpx-runtime/stdout.log",
    stderrLog: "/tmp/weacpx-runtime/stderr.log",
  });
});
