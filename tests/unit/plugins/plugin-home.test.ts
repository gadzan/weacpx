import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { homedir } from "node:os";
import { resolvePluginHome } from "../../../src/plugins/plugin-home.js";

const ORIGINAL_HOME = process.env.HOME;
const ORIGINAL_PLUGIN_HOME = process.env.WEACPX_PLUGIN_HOME;

afterEach(() => {
  if (ORIGINAL_HOME === undefined) delete process.env.HOME;
  else process.env.HOME = ORIGINAL_HOME;
  if (ORIGINAL_PLUGIN_HOME === undefined) delete process.env.WEACPX_PLUGIN_HOME;
  else process.env.WEACPX_PLUGIN_HOME = ORIGINAL_PLUGIN_HOME;
});

describe("resolvePluginHome", () => {
  beforeEach(() => {
    delete process.env.WEACPX_PLUGIN_HOME;
  });

  it("uses an explicit pluginHome when provided", () => {
    expect(resolvePluginHome({ pluginHome: "/custom/path" })).toBe("/custom/path");
  });

  it("uses WEACPX_PLUGIN_HOME env when set", () => {
    process.env.WEACPX_PLUGIN_HOME = "/env/path";
    expect(resolvePluginHome()).toBe("/env/path");
  });

  it("uses input.home + /.weacpx/plugins when provided", () => {
    expect(resolvePluginHome({ home: "/u/alice" })).toBe("/u/alice/.weacpx/plugins");
  });

  it("uses process.env.HOME when no input given", () => {
    process.env.HOME = "/u/bob";
    expect(resolvePluginHome()).toBe("/u/bob/.weacpx/plugins");
  });

  it("falls back to homedir() when HOME env unset", () => {
    delete process.env.HOME;
    expect(resolvePluginHome()).toBe(`${homedir()}/.weacpx/plugins`);
  });

  // --- Regression: the bug that produced undefined/.weacpx/plugins/ in CWD ---

  it("treats input.home === 'undefined' string as missing and falls through", () => {
    process.env.HOME = "/u/carol";
    expect(resolvePluginHome({ home: "undefined" })).toBe("/u/carol/.weacpx/plugins");
  });

  it("treats input.pluginHome === 'undefined' string as missing", () => {
    process.env.HOME = "/u/dave";
    expect(resolvePluginHome({ pluginHome: "undefined" })).toBe("/u/dave/.weacpx/plugins");
  });

  it("treats WEACPX_PLUGIN_HOME === 'undefined' string as missing", () => {
    process.env.WEACPX_PLUGIN_HOME = "undefined";
    process.env.HOME = "/u/eve";
    expect(resolvePluginHome()).toBe("/u/eve/.weacpx/plugins");
  });

  it("treats process.env.HOME === 'undefined' string as missing (the original bug)", () => {
    process.env.HOME = "undefined";
    expect(resolvePluginHome()).toBe(`${homedir()}/.weacpx/plugins`);
  });

  it("also treats 'null' string as missing", () => {
    process.env.HOME = "null";
    expect(resolvePluginHome()).toBe(`${homedir()}/.weacpx/plugins`);
  });
});
