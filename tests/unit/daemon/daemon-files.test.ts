import { expect, test } from "bun:test";
import { join } from "node:path";

import { resolveDaemonPaths } from "../../../src/daemon/daemon-files";

test("resolves runtime files under ~/.weacpx/runtime by default", () => {
  expect(
    resolveDaemonPaths({
      home: "/Users/tester",
    }),
  ).toEqual({
    runtimeDir: join("/Users/tester", ".weacpx", "runtime"),
    pidFile: join("/Users/tester", ".weacpx", "runtime", "daemon.pid"),
    statusFile: join("/Users/tester", ".weacpx", "runtime", "status.json"),
    stdoutLog: join("/Users/tester", ".weacpx", "runtime", "stdout.log"),
    stderrLog: join("/Users/tester", ".weacpx", "runtime", "stderr.log"),
    appLog: join("/Users/tester", ".weacpx", "runtime", "app.log"),
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
    pidFile: join("/tmp/weacpx-runtime", "daemon.pid"),
    statusFile: join("/tmp/weacpx-runtime", "status.json"),
    stdoutLog: join("/tmp/weacpx-runtime", "stdout.log"),
    stderrLog: join("/tmp/weacpx-runtime", "stderr.log"),
    appLog: join("/tmp/weacpx-runtime", "app.log"),
  });
});
