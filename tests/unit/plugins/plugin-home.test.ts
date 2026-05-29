import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { homedir, tmpdir } from "node:os";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { normalizePluginHomeManifest, resolvePluginHome } from "../../../src/plugins/plugin-home.js";

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

describe("normalizePluginHomeManifest", () => {
  it("collapses duplicate dependency keys (last value wins)", async () => {
    const dir = await mkdtemp(join(tmpdir(), "weacpx-norm-"));
    try {
      const manifest = join(dir, "package.json");
      // Simulates the corrupt state bun left on Windows: same package twice,
      // once as an npm version and once as a local path.
      await writeFile(
        manifest,
        '{\n  "private": true,\n  "type": "module",\n  "dependencies": {\n    "@scope/pkg": "0.2.1",\n    "@scope/pkg": "/local/path"\n  }\n}\n',
      );
      const changed = await normalizePluginHomeManifest(dir);
      expect(changed).toBe(true);
      const after = JSON.parse(await readFile(manifest, "utf8")) as { dependencies: Record<string, string> };
      expect(Object.keys(after.dependencies)).toEqual(["@scope/pkg"]);
      expect(after.dependencies["@scope/pkg"]).toBe("/local/path");
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("is a no-op for a clean manifest", async () => {
    const dir = await mkdtemp(join(tmpdir(), "weacpx-norm-"));
    try {
      const manifest = join(dir, "package.json");
      await writeFile(
        manifest,
        JSON.stringify({ private: true, type: "module", dependencies: { "@scope/pkg": "0.2.1" } }, null, 2) + "\n",
      );
      expect(await normalizePluginHomeManifest(dir)).toBe(false);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("returns false when no manifest exists", async () => {
    const dir = await mkdtemp(join(tmpdir(), "weacpx-norm-"));
    try {
      expect(await normalizePluginHomeManifest(dir)).toBe(false);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("leaves an unparseable manifest untouched", async () => {
    const dir = await mkdtemp(join(tmpdir(), "weacpx-norm-"));
    try {
      const manifest = join(dir, "package.json");
      await writeFile(manifest, "{ not valid json ]");
      expect(await normalizePluginHomeManifest(dir)).toBe(false);
      expect(await readFile(manifest, "utf8")).toBe("{ not valid json ]");
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
