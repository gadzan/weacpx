import { expect, test } from "bun:test";

import { checkAcpx } from "../../../src/doctor/checks/acpx-check";

test("acpx check reports configured command source", async () => {
  const result = await checkAcpx({
    loadConfig: async () => ({
      transport: {
        type: "acpx-bridge",
        command: "/custom/acpx",
        permissionMode: "approve-all",
        nonInteractivePermissions: "deny",
      },
    }) as any,
    resolveAcpxCommandMetadata: () => ({
      command: "/custom/acpx",
      source: "config",
      explanation: "transport.command is set, so the configured command wins.",
    }),
    runVersion: async (command) => {
      expect(command).toBe("/custom/acpx");
      return "acpx 1.2.3";
    },
  });

  expect(result.severity).toBe("pass");
  expect(result.summary).toContain("acpx 1.2.3");
  expect(result.metadata).toMatchObject({
    command: "/custom/acpx",
    source: "config",
    version: "acpx 1.2.3",
  });
});

test("acpx check reports bundled dependency source", async () => {
  const result = await checkAcpx({
    loadConfig: async () => ({
      transport: {
        type: "acpx-cli",
        permissionMode: "approve-all",
        nonInteractivePermissions: "deny",
      },
    }) as any,
    resolveAcpxCommandMetadata: () => ({
      command: "/repo/node_modules/acpx/dist/cli.js",
      source: "bundled",
      explanation: "no configured command was set, so the bundled dependency was selected.",
    }),
    runVersion: async () => "acpx 2.0.0",
  });

  expect(result.severity).toBe("pass");
  expect(result.metadata).toMatchObject({
    source: "bundled",
    command: "/repo/node_modules/acpx/dist/cli.js",
  });
});

test("acpx check reports PATH fallback source", async () => {
  const result = await checkAcpx({
    loadConfig: async () => ({
      transport: {
        type: "acpx-cli",
        permissionMode: "approve-all",
        nonInteractivePermissions: "deny",
      },
    }) as any,
    resolveAcpxCommandMetadata: () => ({
      command: "acpx",
      source: "PATH",
      explanation: "configured and bundled acpx were unavailable, so PATH is the fallback.",
    }),
    runVersion: async () => "acpx 3.0.0",
  });

  expect(result.severity).toBe("pass");
  expect(result.metadata).toMatchObject({
    source: "PATH",
    command: "acpx",
  });
});

test("acpx check fails when --version fails", async () => {
  const result = await checkAcpx({
    loadConfig: async () => ({
      transport: {
        type: "acpx-bridge",
        command: "/broken/acpx",
        permissionMode: "approve-all",
        nonInteractivePermissions: "deny",
      },
    }) as any,
    resolveAcpxCommandMetadata: () => ({
      command: "/broken/acpx",
      source: "config",
      explanation: "transport.command is set, so the configured command wins.",
    }),
    runVersion: async () => {
      throw new Error("exit 127");
    },
  });

  expect(result.severity).toBe("fail");
  expect(result.details?.join("\n") ?? "").toContain("exit 127");
});

test("acpx check includes resolution explanation in verbose mode", async () => {
  const result = await checkAcpx({
    verbose: true,
    loadConfig: async () => ({
      transport: {
        type: "acpx-cli",
        permissionMode: "approve-all",
        nonInteractivePermissions: "deny",
      },
    }) as any,
    resolveAcpxCommandMetadata: () => ({
      command: "acpx",
      source: "PATH",
      explanation: "configured and bundled acpx were unavailable, so PATH is the fallback.",
    }),
    runVersion: async () => "acpx 4.0.0",
  });

  expect(result.severity).toBe("pass");
  expect(result.details).toContain("resolution: configured and bundled acpx were unavailable, so PATH is the fallback.");
});
