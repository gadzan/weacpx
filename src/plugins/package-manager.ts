import { spawn } from "node:child_process";

import { normalizePluginHomeManifest } from "./plugin-home.js";

export type PluginPackageManager = "bun" | "npm";

export interface RunCommandOptions {
  cwd: string;
}

export type RunCommand = (command: string, args: string[], options: RunCommandOptions) => Promise<void>;

async function defaultRunCommand(command: string, args: string[], options: RunCommandOptions): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const child = spawn(command, args, { cwd: options.cwd, stdio: "inherit" });
    child.on("error", reject);
    child.on("exit", (code) => {
      if (code === 0) resolve();
      else reject(new Error(`${command} ${args.join(" ")} exited with code ${code}`));
    });
  });
}

async function silentRun(command: string, args: string[], options: RunCommandOptions): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const child = spawn(command, args, { cwd: options.cwd, stdio: "ignore" });
    child.on("error", reject);
    child.on("exit", (code) => {
      if (code === 0) resolve();
      else reject(new Error(`${command} ${args.join(" ")} exited with code ${code}`));
    });
  });
}

export async function detectPackageManager(runCommand?: RunCommand): Promise<PluginPackageManager> {
  const override = process.env.WEACPX_PACKAGE_MANAGER?.trim().toLowerCase();
  if (override === "bun" || override === "npm") return override;
  const probe = runCommand ?? silentRun;
  try {
    await probe("bun", ["--version"], { cwd: process.cwd() });
    return "bun";
  } catch {
    return "npm";
  }
}

export async function installPluginPackage(input: {
  packageName: string;
  version?: string;
  pluginHome: string;
  packageManager?: PluginPackageManager;
  runCommand?: RunCommand;
}): Promise<void> {
  const runCommand = input.runCommand ?? defaultRunCommand;
  const packageManager = input.packageManager ?? await detectPackageManager();
  // Repair any duplicate dependency keys a prior add may have left (e.g. bun on
  // Windows recording a package under both an npm version and a local path),
  // which would otherwise make the package manager choke on the lockfile.
  await normalizePluginHomeManifest(input.pluginHome);
  const spec = input.version ? `${input.packageName}@${input.version}` : input.packageName;
  if (packageManager === "bun") {
    await runCommand("bun", ["add", spec], { cwd: input.pluginHome });
    return;
  }
  await runCommand("npm", ["install", spec], { cwd: input.pluginHome });
}

export async function updatePluginPackage(input: {
  packageName: string;
  version?: string;
  pluginHome: string;
  packageManager?: PluginPackageManager;
  runCommand?: RunCommand;
}): Promise<void> {
  await installPluginPackage(input);
}

export async function removePluginPackage(input: {
  packageName: string;
  pluginHome: string;
  packageManager?: PluginPackageManager;
  runCommand?: RunCommand;
}): Promise<void> {
  const runCommand = input.runCommand ?? defaultRunCommand;
  const packageManager = input.packageManager ?? await detectPackageManager();
  if (packageManager === "bun") {
    await runCommand("bun", ["remove", input.packageName], { cwd: input.pluginHome });
    return;
  }
  await runCommand("npm", ["uninstall", input.packageName], { cwd: input.pluginHome });
}
