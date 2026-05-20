import { expect, test } from "bun:test";
import {
  allocateWorkspaceName,
  isWorkspaceNameValid,
  quoteWorkspaceNameIfNeeded,
  sanitizeWorkspaceName,
} from "../../../src/commands/workspace-name";

test("sanitizeWorkspaceName keeps clean ASCII names", () => {
  expect(sanitizeWorkspaceName("backend")).toBe("backend");
  expect(sanitizeWorkspaceName("api.v2")).toBe("api.v2");
  expect(sanitizeWorkspaceName("my_repo-1")).toBe("my_repo-1");
});

test("sanitizeWorkspaceName replaces whitespace and unsafe runs with single dash", () => {
  expect(sanitizeWorkspaceName("My Project")).toBe("My-Project");
  expect(sanitizeWorkspaceName("foo  bar")).toBe("foo-bar");
  expect(sanitizeWorkspaceName("foo/bar baz")).toBe("foo-bar-baz");
});

test("sanitizeWorkspaceName trims leading and trailing dashes", () => {
  expect(sanitizeWorkspaceName("  spaced  ")).toBe("spaced");
  expect(sanitizeWorkspaceName("--weird--")).toBe("weird");
});

test("sanitizeWorkspaceName falls back when everything is stripped", () => {
  expect(sanitizeWorkspaceName("测试项目")).toBe("workspace");
  expect(sanitizeWorkspaceName("")).toBe("workspace");
  expect(sanitizeWorkspaceName("   ")).toBe("workspace");
  expect(sanitizeWorkspaceName("中文", "fallback")).toBe("fallback");
});

test("sanitizeWorkspaceName ignores custom fallback when input survives sanitization", () => {
  expect(sanitizeWorkspaceName("backend", "other")).toBe("backend");
  expect(sanitizeWorkspaceName("My Project", "other")).toBe("My-Project");
});

test("allocateWorkspaceName returns base when free, appends suffix when taken", () => {
  expect(allocateWorkspaceName("backend", {})).toBe("backend");
  expect(allocateWorkspaceName("backend", { backend: 1 })).toBe("backend-2");
  expect(allocateWorkspaceName("backend", { backend: 1, "backend-2": 1 })).toBe(
    "backend-3",
  );
});

test("isWorkspaceNameValid matches the sanitize alphabet", () => {
  expect(isWorkspaceNameValid("backend")).toBe(true);
  expect(isWorkspaceNameValid("api.v2_3-final")).toBe(true);
  expect(isWorkspaceNameValid("")).toBe(false);
  expect(isWorkspaceNameValid("My Project")).toBe(false);
  expect(isWorkspaceNameValid("中文")).toBe(false);
  expect(isWorkspaceNameValid("foo/bar")).toBe(false);
});

test("quoteWorkspaceNameIfNeeded wraps names with unsafe characters", () => {
  expect(quoteWorkspaceNameIfNeeded("backend")).toBe("backend");
  expect(quoteWorkspaceNameIfNeeded("api.v2_3-final")).toBe("api.v2_3-final");
  expect(quoteWorkspaceNameIfNeeded("My Project")).toBe('"My Project"');
  expect(quoteWorkspaceNameIfNeeded("中文")).toBe('"中文"');
  expect(quoteWorkspaceNameIfNeeded('say"hi')).toBe('"say\\"hi"');
  expect(quoteWorkspaceNameIfNeeded("a\\b")).toBe('"a\\\\b"');
});
