import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";

function readJson(path: string) {
  return JSON.parse(readFileSync(path, "utf8"));
}

test("root package publishes as weacpx and exposes plugin-api", () => {
  const pkg = readJson("package.json");

  expect(pkg.name).toBe("weacpx");
  expect(pkg.bin).toEqual({ weacpx: "./dist/cli.js" });
  expect(pkg.exports["./plugin-api"]).toEqual({
    types: "./dist/plugin-api.d.ts",
    default: "./dist/plugin-api.js",
  });
});

test("root package version is above the latest published 0.3.2", () => {
  const pkg = readJson("package.json");
  const [major, minor, patch] = String(pkg.version).split(".").map((part) => Number.parseInt(part, 10));

  expect(Number.isFinite(major) && Number.isFinite(minor) && Number.isFinite(patch)).toBe(true);
  // A fresh publish must bump above the npm `latest` of weacpx@0.3.2.
  const cmp = major * 1_000_000 + minor * 1_000 + patch;
  expect(cmp).toBeGreaterThan(0 * 1_000_000 + 3 * 1_000 + 2);
});

test("first-party channel plugins peer depend on weacpx", () => {
  const feishu = readJson("packages/channel-feishu/package.json");
  const yuanbao = readJson("packages/channel-yuanbao/package.json");

  for (const pkg of [feishu, yuanbao]) {
    expect(pkg.peerDependencies.weacpx).toBe(">=0.3.3");
    expect(pkg.peerDependencies["weacpx-console"]).toBeUndefined();
    expect(pkg.peerDependenciesMeta.weacpx.optional).toBe(true);
    expect(pkg.peerDependenciesMeta["weacpx-console"]).toBeUndefined();
    expect(pkg.publishConfig.access).toBe("public");
  }
});
