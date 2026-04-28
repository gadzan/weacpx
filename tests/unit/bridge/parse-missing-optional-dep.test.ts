import { describe, expect, test } from "bun:test";
import { parseMissingOptionalDep } from "../../../src/bridge/parse-missing-optional-dep";

describe("parseMissingOptionalDep", () => {
  test("extracts package name from double-quoted opencode message", () => {
    const text = `It seems that your package manager failed to install the right version of the opencode CLI for your platform. You can try manually installing "opencode-windows-x64" or "opencode-windows-x64-baseline" package`;
    expect(parseMissingOptionalDep(text)).toEqual({ package: "opencode-windows-x64" });
  });

  test("extracts package name with single quotes", () => {
    const text = `You can try manually installing 'some-pkg-linux-x64' package`;
    expect(parseMissingOptionalDep(text)).toEqual({ package: "some-pkg-linux-x64" });
  });

  test("extracts scoped package name", () => {
    const text = `You can try manually installing "@scope/pkg-darwin-arm64" package`;
    expect(parseMissingOptionalDep(text)).toEqual({ package: "@scope/pkg-darwin-arm64" });
  });

  test("returns null for unrelated error", () => {
    expect(parseMissingOptionalDep("some random error")).toBeNull();
  });

  test("returns null when captured token has illegal characters", () => {
    const text = `You can try manually installing "bad pkg!" package`;
    expect(parseMissingOptionalDep(text)).toBeNull();
  });

  test("returns null when no quotes around the name", () => {
    expect(parseMissingOptionalDep("You can try manually installing somepkg package")).toBeNull();
  });
});
