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

test("root package version is 0.5.0", () => {
  const pkg = readJson("package.json");

  expect(pkg.version).toBe("0.5.0");
});

test("first-party channel plugins peer depend on weacpx", () => {
  const feishu = readJson("packages/channel-feishu/package.json");
  const yuanbao = readJson("packages/channel-yuanbao/package.json");

  for (const pkg of [feishu, yuanbao]) {
    expect(pkg.peerDependencies.weacpx).toBe(">=0.5.0-0");
    expect(pkg.peerDependencies["weacpx-console"]).toBeUndefined();
    expect(pkg.peerDependenciesMeta.weacpx.optional).toBe(true);
    expect(pkg.peerDependenciesMeta["weacpx-console"]).toBeUndefined();
    expect(pkg.publishConfig.access).toBe("public");
  }
});
