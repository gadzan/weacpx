#!/usr/bin/env node
/**
 * Local-only smoke test for the pre-publish install loop.
 *
 * 1. Optionally run `bun run verify:publish` to rebuild artifacts.
 * 2. `npm pack` the root and first-party channel plugins into a temp dir.
 * 3. Create a clean temp project, `npm install <root.tgz>`.
 * 4. Run a sequence of CLI commands (`--version`, `plugin list`, `plugin add`,
 *    `plugin doctor`, `plugin rm`) and assert they succeed without restart so
 *    the daemon is never started.
 *
 * Usage:
 *   node ./scripts/smoke-local-install.mjs [--skip-build] [--keep-temp]
 *
 * Flags:
 *   --skip-build  Skip `bun run verify:publish`. Use after a known-good build.
 *   --keep-temp   Keep the temp pack/install dirs. Path is printed at the end.
 *
 * NOTE: Opt-in. Not part of `npm test`. Designed for macOS/Linux; the docs
 * cover the Windows PowerShell equivalent.
 */

import { spawnSync } from "node:child_process";
import { mkdtemp, mkdir, readFile, rm, writeFile, readdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const flags = new Set(process.argv.slice(2));
const skipBuild = flags.has("--skip-build");
const keepTemp = flags.has("--keep-temp");

function log(message) {
  process.stdout.write(`[smoke] ${message}\n`);
}

function fail(message) {
  process.stderr.write(`[smoke][error] ${message}\n`);
  process.exitCode = 1;
}

function run(command, args, options = {}) {
  log(`$ ${command} ${args.join(" ")} (cwd=${options.cwd ?? process.cwd()})`);
  const captureStdout = options.captureStdout || options.captureBoth;
  const captureStderr = options.captureBoth;
  const result = spawnSync(command, args, {
    stdio: [
      "ignore",
      captureStdout ? "pipe" : "inherit",
      captureStderr ? "pipe" : "inherit",
    ],
    cwd: options.cwd,
    env: options.env ?? process.env,
    encoding: "utf8",
  });
  if (result.error) throw result.error;
  const status = typeof result.status === "number" ? result.status : 1;
  if (options.expectFailure) {
    if (status === 0) {
      throw new Error(`expected ${command} ${args.join(" ")} to fail, but it exited with 0`);
    }
    return { status, stdout: result.stdout ?? "", stderr: result.stderr ?? "" };
  }
  if (status !== 0) {
    if (captureStdout) process.stdout.write(result.stdout ?? "");
    if (captureStderr) process.stderr.write(result.stderr ?? "");
    throw new Error(`${command} ${args.join(" ")} exited with code ${status}`);
  }
  return { status: 0, stdout: result.stdout ?? "", stderr: result.stderr ?? "" };
}

async function readJson(path) {
  return JSON.parse(await readFile(path, "utf8"));
}

async function packPackage(pkgDir, packDir) {
  const before = new Set(await readdir(packDir));
  run("npm", ["pack", "--pack-destination", packDir], { cwd: pkgDir });
  const after = await readdir(packDir);
  for (const file of after) {
    if (!before.has(file) && file.endsWith(".tgz")) return join(packDir, file);
  }
  throw new Error(`failed to locate tarball produced from ${pkgDir}`);
}

async function main() {
  if (!skipBuild) {
    log("running bun run verify:publish");
    run("bun", ["run", "verify:publish"], { cwd: repoRoot });
  } else {
    log("skipping verify:publish");
  }

  const packDir = await mkdtemp(join(tmpdir(), "weacpx-pack-"));
  const projectDir = await mkdtemp(join(tmpdir(), "weacpx-install-"));
  log(`pack dir: ${packDir}`);
  log(`install dir: ${projectDir}`);

  let cleanup = async () => {
    if (keepTemp) {
      log(`--keep-temp: leaving ${packDir} and ${projectDir}`);
      return;
    }
    await rm(packDir, { recursive: true, force: true });
    await rm(projectDir, { recursive: true, force: true });
  };

  try {
    log("packing root + plugins");
    const rootTarball = await packPackage(repoRoot, packDir);
    const feishuTarball = await packPackage(join(repoRoot, "packages", "channel-feishu"), packDir);
    const yuanbaoTarball = await packPackage(join(repoRoot, "packages", "channel-yuanbao"), packDir);

    log("creating empty project");
    await writeFile(
      join(projectDir, "package.json"),
      JSON.stringify({ name: "weacpx-smoke-fixture", private: true, version: "0.0.0" }, null, 2),
    );

    log("installing root tarball");
    run("npm", ["install", "--no-audit", "--no-fund", rootTarball], { cwd: projectDir });

    const cliPath = join(projectDir, "node_modules", ".bin", "weacpx");

    const expectedVersion = (await readJson(join(repoRoot, "package.json"))).version;

    log("checking weacpx --version");
    const versionOutput = run(cliPath, ["--version"], { cwd: projectDir, captureStdout: true }).stdout.trim();
    if (versionOutput !== expectedVersion) {
      throw new Error(`expected --version to print ${expectedVersion}, got ${versionOutput}`);
    }

    // Use an isolated home so smoke runs do not touch the developer's
    // ~/.weacpx state. Force npm as the plugin package manager so the smoke
    // is independent of whether bun is installed in the test environment.
    const fakeHome = await mkdtemp(join(tmpdir(), "weacpx-home-"));
    const env = {
      ...process.env,
      HOME: fakeHome,
      USERPROFILE: fakeHome,
      WEACPX_PACKAGE_MANAGER: "npm",
    };
    const previousCleanup = cleanup;
    cleanup = async () => {
      await previousCleanup();
      if (!keepTemp) await rm(fakeHome, { recursive: true, force: true });
    };

    log("plugin list (empty)");
    run(cliPath, ["plugin", "list"], { cwd: projectDir, env });

    log("plugin add feishu (--no-restart)");
    run(cliPath, ["plugin", "add", feishuTarball, "--no-restart"], { cwd: projectDir, env });

    log("plugin add yuanbao (--no-restart)");
    run(cliPath, ["plugin", "add", yuanbaoTarball, "--no-restart"], { cwd: projectDir, env });

    log("plugin list (after install)");
    run(cliPath, ["plugin", "list"], { cwd: projectDir, env });

    log("plugin doctor (no channels yet)");
    run(cliPath, ["plugin", "doctor"], { cwd: projectDir, env });

    log("channel add feishu (--no-restart)");
    run(cliPath, [
      "channel", "add", "feishu",
      "--app-id", "smoke-app-id",
      "--app-secret", "smoke-app-secret",
      "--no-restart",
    ], { cwd: projectDir, env });

    log("channel add yuanbao (--no-restart)");
    run(cliPath, [
      "channel", "add", "yuanbao",
      "--app-key", "smoke-app-key",
      "--app-secret", "smoke-app-secret",
      "--no-restart",
    ], { cwd: projectDir, env });

    log("channel list (after add)");
    const listOutput = run(cliPath, ["channel", "list"], { cwd: projectDir, env, captureStdout: true }).stdout;
    process.stdout.write(listOutput);
    for (const expected of ["feishu", "yuanbao"]) {
      if (!listOutput.includes(expected)) {
        throw new Error(`channel list output missing ${expected}: ${listOutput}`);
      }
    }

    log("channel show feishu");
    run(cliPath, ["channel", "show", "feishu"], { cwd: projectDir, env });

    log("channel show yuanbao");
    run(cliPath, ["channel", "show", "yuanbao"], { cwd: projectDir, env });

    log("plugin doctor (with channels configured)");
    run(cliPath, ["plugin", "doctor"], { cwd: projectDir, env });

    log("plugin rm yuanbao while channel still depends on it (must fail)");
    const blocked = run(
      cliPath,
      ["plugin", "rm", "@ganglion/weacpx-channel-yuanbao", "--no-restart"],
      { cwd: projectDir, env, captureBoth: true, expectFailure: true },
    );
    process.stdout.write(blocked.stdout);
    process.stderr.write(blocked.stderr);
    const blockedText = `${blocked.stdout}\n${blocked.stderr}`;
    if (!blockedText.includes("yuanbao") || !blockedText.includes("weacpx channel rm")) {
      throw new Error(`expected dependency-guard hint, got:\n${blockedText}`);
    }

    log("channel rm yuanbao (--no-restart)");
    run(cliPath, ["channel", "rm", "yuanbao", "--no-restart"], { cwd: projectDir, env });

    log("plugin rm yuanbao after channel removed (--no-restart)");
    run(cliPath, ["plugin", "rm", "@ganglion/weacpx-channel-yuanbao", "--no-restart"], { cwd: projectDir, env });

    log("channel rm feishu (--no-restart)");
    run(cliPath, ["channel", "rm", "feishu", "--no-restart"], { cwd: projectDir, env });

    log("plugin rm feishu (--no-restart)");
    run(cliPath, ["plugin", "rm", "@ganglion/weacpx-channel-feishu", "--no-restart"], { cwd: projectDir, env });

    log("smoke install closure: OK");
  } catch (error) {
    fail(error instanceof Error ? error.message : String(error));
  } finally {
    await cleanup();
  }
}

main().catch((error) => {
  fail(error instanceof Error ? error.stack ?? error.message : String(error));
});
