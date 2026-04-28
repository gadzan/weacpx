import { describe, expect, test } from "bun:test";
import { join } from "node:path";
import {
  deriveParentPackageName,
  discoverParentPackagePaths,
  type DiscoverDeps,
} from "../../../src/recovery/discover-parent-package-paths";

describe("deriveParentPackageName", () => {
  test("strips os-arch suffix", () => {
    expect(deriveParentPackageName("opencode-windows-x64")).toBe("opencode");
    expect(deriveParentPackageName("esbuild-darwin-x64")).toBe("esbuild");
    expect(deriveParentPackageName("foo-linux-arm64")).toBe("foo");
  });

  test("strips os-arch-libc suffix", () => {
    expect(deriveParentPackageName("foo-linux-arm64-musl")).toBe("foo");
    expect(deriveParentPackageName("foo-linux-x64-gnu")).toBe("foo");
  });

  test("strips scoped package suffix", () => {
    expect(deriveParentPackageName("@scope/pkg-linux-arm64-musl")).toBe("@scope/pkg");
  });

  test("returns unchanged when no platform suffix", () => {
    expect(deriveParentPackageName("opencode")).toBe("opencode");
    expect(deriveParentPackageName("@scope/pkg")).toBe("@scope/pkg");
  });
});

function makeDeps(overrides: Partial<DiscoverDeps> = {}): DiscoverDeps {
  return {
    env: {},
    home: "/home/test",
    platform: "linux",
    fsExists: async () => false,
    resolveFromCwd: () => null,
    queryPackageManagerRoot: async () => null,
    ...overrides,
  };
}

describe("discoverParentPackagePaths", () => {
  test("returns seed tagged npm by default when no PM root matches", async () => {
    const seed = "/seed/opencode";
    const seedPkg = join(seed, "package.json");
    const deps = makeDeps({
      fsExists: async (p) => p === seedPkg,
    });
    const result = await discoverParentPackagePaths("opencode-windows-x64", seed, deps);
    expect(result).toEqual([{ path: seed, manager: "npm" }]);
  });

  test("filters out non-existent candidates", async () => {
    const deps = makeDeps({ fsExists: async () => false });
    const result = await discoverParentPackagePaths("opencode-windows-x64", "/seed/opencode", deps);
    expect(result).toEqual([]);
  });

  test("classifies seed under Bun global root as bun", async () => {
    const bunRoot = join("/home/test", ".bun", "install", "global", "node_modules");
    const seed = join(bunRoot, "opencode");
    const deps = makeDeps({
      fsExists: async (p) => p === join(seed, "package.json"),
    });
    const result = await discoverParentPackagePaths("opencode-windows-x64", seed, deps);
    expect(result).toEqual([{ path: seed, manager: "bun" }]);
  });

  test("classifies seed under pnpm root as pnpm", async () => {
    const pnpmRoot = join("/pnpm-root");
    const seed = join(pnpmRoot, "opencode");
    const deps = makeDeps({
      queryPackageManagerRoot: async (tool) => (tool === "pnpm" ? pnpmRoot : null),
      fsExists: async (p) => p === join(seed, "package.json"),
    });
    const result = await discoverParentPackagePaths("opencode-windows-x64", seed, deps);
    expect(result).toEqual([{ path: seed, manager: "pnpm" }]);
  });

  test("includes resolveFromCwd result for parent name", async () => {
    const cwdPath = join("/cwd", "node_modules", "opencode");
    const deps = makeDeps({
      resolveFromCwd: (name) => (name === "opencode" ? cwdPath : null),
      fsExists: async (p) => p === join(cwdPath, "package.json"),
    });
    const result = await discoverParentPackagePaths("opencode-windows-x64", null, deps);
    expect(result).toEqual([{ path: cwdPath, manager: "npm" }]);
  });

  test("includes Bun global root using BUN_INSTALL when set", async () => {
    const bunPath = join("/custom/bun", "install", "global", "node_modules", "opencode");
    const deps = makeDeps({
      env: { BUN_INSTALL: "/custom/bun" },
      fsExists: async (p) => p === join(bunPath, "package.json"),
    });
    const result = await discoverParentPackagePaths("opencode-windows-x64", null, deps);
    expect(result).toEqual([{ path: bunPath, manager: "bun" }]);
  });

  test("includes Bun global root under home when BUN_INSTALL unset", async () => {
    const bunPath = join("/home/test", ".bun", "install", "global", "node_modules", "opencode");
    const deps = makeDeps({
      fsExists: async (p) => p === join(bunPath, "package.json"),
    });
    const result = await discoverParentPackagePaths("opencode-windows-x64", null, deps);
    expect(result).toEqual([{ path: bunPath, manager: "bun" }]);
  });

  test("tags npm/pnpm/yarn roots with their respective managers", async () => {
    const npmPath = join("/npm-root", "opencode");
    const pnpmPath = join("/pnpm-root", "opencode");
    const yarnRoot = join("/yarn-root", "node_modules");
    const yarnPath = join(yarnRoot, "opencode");
    const deps = makeDeps({
      queryPackageManagerRoot: async (tool) => {
        if (tool === "npm") return "/npm-root";
        if (tool === "pnpm") return "/pnpm-root";
        if (tool === "yarn") return yarnRoot;
        return null;
      },
      fsExists: async (p) =>
        p === join(npmPath, "package.json") ||
        p === join(pnpmPath, "package.json") ||
        p === join(yarnPath, "package.json"),
    });
    const result = await discoverParentPackagePaths("opencode-windows-x64", null, deps);
    expect(result).toContainEqual({ path: npmPath, manager: "npm" });
    expect(result).toContainEqual({ path: pnpmPath, manager: "pnpm" });
    expect(result).toContainEqual({ path: yarnPath, manager: "yarn" });
  });

  test("dedupes candidates pointing at the same dir, first wins", async () => {
    const sharedPath = join("/shared", "opencode");
    const deps = makeDeps({
      resolveFromCwd: () => sharedPath,
      queryPackageManagerRoot: async (tool) => (tool === "npm" ? "/shared" : null),
      fsExists: async (p) => p === join(sharedPath, "package.json"),
    });
    const result = await discoverParentPackagePaths("opencode-windows-x64", sharedPath, deps);
    expect(result).toEqual([{ path: sharedPath, manager: "npm" }]);
  });

  test("returns multiple distinct install trees with per-tree manager tags", async () => {
    const bunPath = join("/bun", "install", "global", "node_modules", "opencode");
    const cwdPath = join("/cwd", "node_modules", "opencode");
    const npmPath = join("/npm-root", "opencode");
    const deps = makeDeps({
      env: { BUN_INSTALL: "/bun" },
      resolveFromCwd: () => cwdPath,
      queryPackageManagerRoot: async (tool) => (tool === "npm" ? "/npm-root" : null),
      fsExists: async (p) =>
        p === join(bunPath, "package.json") ||
        p === join(cwdPath, "package.json") ||
        p === join(npmPath, "package.json"),
    });
    const result = await discoverParentPackagePaths("opencode-windows-x64", null, deps);
    expect(new Set(result)).toEqual(
      new Set([
        { path: cwdPath, manager: "npm" },
        { path: bunPath, manager: "bun" },
        { path: npmPath, manager: "npm" },
      ]),
    );
  });
});
