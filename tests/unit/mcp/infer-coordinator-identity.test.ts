import { expect, test } from "bun:test";
import { pathToFileURL } from "node:url";

import {
  inferExternalCoordinatorSession,
  inferWorkspaceFromRoots,
} from "../../../src/mcp/infer-coordinator-identity";

test("infers the most specific configured workspace from MCP file roots", () => {
  const repoRoot = process.platform === "win32" ? "C:\\repo" : "/repo";
  const backendRoot = process.platform === "win32" ? "C:\\repo\\backend" : "/repo/backend";
  expect(
    inferWorkspaceFromRoots({
      roots: [{ uri: pathToFileURL(process.platform === "win32" ? "C:\\repo\\backend\\src" : "/repo/backend/src").href }],
      config: {
        workspaces: {
          repo: { cwd: repoRoot },
          backend: { cwd: backendRoot },
        },
      },
    }),
  ).toBe("backend");
});

test("rejects missing or ambiguous MCP roots instead of guessing a workspace", () => {
  const backendRoot = process.platform === "win32" ? "C:\\repo\\backend" : "/repo/backend";
  expect(() =>
    inferWorkspaceFromRoots({
      roots: [{ uri: "memory://not-a-file-root" }],
      config: { workspaces: { backend: { cwd: backendRoot } } },
    }),
  ).toThrow("cannot infer workspace from MCP roots; configure --workspace <name>");

  const ambiguousRoot = process.platform === "win32" ? "C:\\repo\\backend" : "/repo/backend";
  expect(() =>
    inferWorkspaceFromRoots({
      roots: [{ uri: pathToFileURL(ambiguousRoot).href }],
      config: {
        workspaces: {
          backend: { cwd: ambiguousRoot },
          alias: { cwd: ambiguousRoot },
        },
      },
    }),
  ).toThrow("MCP roots match multiple workspaces (backend, alias); configure --workspace <name>");
});


test("rejects independent roots that match different workspaces", () => {
  const aRoot = process.platform === "win32" ? "C:\\repo\\a" : "/repo/a";
  const backendRoot = process.platform === "win32" ? "C:\\repo\\backend-longer" : "/repo/backend-longer";
  expect(() =>
    inferWorkspaceFromRoots({
      roots: [
        { uri: pathToFileURL(aRoot).href },
        { uri: pathToFileURL(backendRoot).href },
      ],
      config: {
        workspaces: {
          a: { cwd: aRoot },
          backend: { cwd: backendRoot },
        },
      },
    }),
  ).toThrow("MCP roots match multiple workspaces (a, backend); configure --workspace <name>");
});

test("generates external coordinator sessions from sanitized MCP client names", () => {
  expect(inferExternalCoordinatorSession({ clientName: "Claude Code", workspace: "backend" })).toBe(
    "external_claude-code:backend",
  );
  expect(inferExternalCoordinatorSession({ clientName: " ??? ", workspace: "backend" })).toBe(
    "external_mcp-host:backend",
  );
});
