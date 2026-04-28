import { expect, test } from "bun:test";

import {
  resolveDaemonOrchestrationSocketPath,
  resolveRuntimeDirFromConfigPath,
} from "../../../src/daemon/daemon-files";
import { resolveDefaultOrchestrationEndpoint } from "../../../src/mcp/resolve-endpoint";

test("resolves the default orchestration endpoint from the configured socket override", () => {
  const endpoint = resolveDefaultOrchestrationEndpoint(
    {
      HOME: "/home/tester",
      WEACPX_ORCHESTRATION_SOCKET: "/tmp/custom-orchestration.sock",
    },
    "linux",
  );

  expect(endpoint).toEqual({
    kind: "unix",
    path: "/tmp/custom-orchestration.sock",
  });
});

test("resolves the default orchestration endpoint from WEACPX_CONFIG when no socket override is set", () => {
  const configPath = "/tmp/weacpx-custom/config.json";
  const endpoint = resolveDefaultOrchestrationEndpoint(
    {
      HOME: "/home/tester",
      WEACPX_CONFIG: configPath,
    },
    "linux",
  );

  const expectedPath = resolveDaemonOrchestrationSocketPath(
    resolveRuntimeDirFromConfigPath(configPath),
    "linux",
  );

  expect(endpoint).toEqual({
    kind: "unix",
    path: expectedPath,
  });
});

test("resolves the default orchestration endpoint consistently for Windows-style config paths", () => {
  const configPath = "C:\\Users\\tester\\custom\\config.json";
  const endpoint = resolveDefaultOrchestrationEndpoint(
    {
      HOME: "C:\\Users\\tester",
      WEACPX_CONFIG: configPath,
    },
    "win32",
  );

  const expectedPath = resolveDaemonOrchestrationSocketPath(
    resolveRuntimeDirFromConfigPath(configPath),
    "win32",
  );

  expect(endpoint).toEqual({
    kind: "named-pipe",
    path: expectedPath,
  });
});
