import { describe, expect, test } from "vitest";
import { slugify, genAlias, uniqueName, workspaceNameFromPath } from "../lib/session-form";

describe("slugify", () => {
  test("lowercases and replaces non [a-z0-9-] runs with a single dash", () => {
    expect(slugify("My Cool_Workspace!")).toBe("my-cool-workspace");
    expect(slugify("  --Trim--  ")).toBe("trim");
  });
});

describe("genAlias", () => {
  test("joins workspace and agent", () => {
    expect(genAlias("backend", "codex")).toBe("backend-codex");
    expect(genAlias("My WS", "Codex")).toBe("my-ws-codex");
  });
});

describe("uniqueName", () => {
  test("returns base when free, else suffixes -2, -3", () => {
    expect(uniqueName("backend-codex", [])).toBe("backend-codex");
    expect(uniqueName("backend-codex", ["backend-codex"])).toBe("backend-codex-2");
    expect(uniqueName("backend-codex", ["backend-codex", "backend-codex-2"])).toBe("backend-codex-3");
  });
});

describe("workspaceNameFromPath", () => {
  test("uses the basename, slugified", () => {
    expect(workspaceNameFromPath("/tmp/demo-project")).toBe("demo-project");
    expect(workspaceNameFromPath("/Users/me/My App/")).toBe("my-app");
    expect(workspaceNameFromPath("C:\\\\work\\\\Repo One")).toBe("repo-one");
  });
});
