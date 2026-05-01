import { expect, test } from "bun:test";
import { pathToFileURL } from "node:url";

import {
  inferExternalCoordinatorSession,
  inferWorkspaceFromRoots,
} from "../../../src/mcp/infer-coordinator-identity";

test("infers the most specific configured workspace from MCP file roots", () => {
  expect(
    inferWorkspaceFromRoots({
      roots: [{ uri: pathToFileURL("/repo/backend/src").href }],
      config: {
        workspaces: {
          repo: { cwd: "/repo" },
          backend: { cwd: "/repo/backend" },
        },
      },
    }),
  ).toBe("backend");
});

test("rejects missing or ambiguous MCP roots instead of guessing a workspace", () => {
  expect(() =>
    inferWorkspaceFromRoots({
      roots: [{ uri: "memory://not-a-file-root" }],
      config: { workspaces: { backend: { cwd: "/repo/backend" } } },
    }),
  ).toThrow("cannot infer workspace from MCP roots; configure --workspace <name>");

  expect(() =>
    inferWorkspaceFromRoots({
      roots: [{ uri: pathToFileURL("/repo/backend").href }],
      config: {
        workspaces: {
          backend: { cwd: "/repo/backend" },
          alias: { cwd: "/repo/backend" },
        },
      },
    }),
  ).toThrow("MCP roots match multiple workspaces (backend, alias); configure --workspace <name>");
});


test("rejects independent roots that match different workspaces", () => {
  expect(() =>
    inferWorkspaceFromRoots({
      roots: [
        { uri: pathToFileURL("/repo/a").href },
        { uri: pathToFileURL("/repo/backend-longer").href },
      ],
      config: {
        workspaces: {
          a: { cwd: "/repo/a" },
          backend: { cwd: "/repo/backend-longer" },
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
