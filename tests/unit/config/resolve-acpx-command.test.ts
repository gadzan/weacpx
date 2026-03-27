import { expect, test } from "bun:test";
import { dirname, resolve } from "node:path";

import { resolveAcpxCommand } from "../../../src/config/resolve-acpx-command";

test("prefers an explicit transport command", () => {
  expect(
    resolveAcpxCommand({
      configuredCommand: "/custom/acpx",
      resolvePackageJson: () => {
        throw new Error("should not resolve package");
      },
      readPackageJson: () => {
        throw new Error("should not read package");
      },
    }),
  ).toBe("/custom/acpx");
});

test("resolves the local acpx bin from the installed package", () => {
  expect(
    resolveAcpxCommand({
      platform: "linux",
      resolvePackageJson: () => "E:/project/node_modules/acpx/package.json",
      readPackageJson: () => ({
        bin: {
          acpx: "bin/acpx.js",
        },
      }),
    }),
  ).toBe(resolve(dirname("E:/project/node_modules/acpx/package.json"), "bin/acpx.js"));
});

test("resolves the local acpx windows shim on win32", () => {
  expect(
    resolveAcpxCommand({
      platform: "win32",
      resolvePackageJson: () => "E:/project/node_modules/acpx/package.json",
      readPackageJson: () => ({
        bin: {
          acpx: "dist/cli.js",
        },
      }),
    }),
  ).toBe("E:\\project\\node_modules\\acpx\\dist\\cli.js");
});

test("falls back to PATH acpx when the package is not installed", () => {
  expect(
    resolveAcpxCommand({
      resolvePackageJson: () => {
        throw new Error("not found");
      },
      readPackageJson: () => {
        throw new Error("should not read package");
      },
    }),
  ).toBe("acpx");
});
