import { spawn } from "node:child_process";

import { loadConfig } from "../../config/load-config";
import { resolveAcpxCommandMetadata, type AcpxCommandMetadata } from "../../config/resolve-acpx-command";
import type { AppConfig } from "../../config/types";
import { resolveRuntimePaths, type RuntimePaths } from "../../main";
import { resolveSpawnCommand } from "../../process/spawn-command";
import type { DoctorCheckResult } from "../doctor-types";

export interface AcpxCheckOptions {
  verbose?: boolean;
  resolveRuntimePaths?: () => RuntimePaths;
  loadConfig?: (configPath: string) => Promise<AppConfig>;
  resolveAcpxCommandMetadata?: (options: { configuredCommand?: string }) => AcpxCommandMetadata;
  runVersion?: (command: string) => Promise<string>;
}

export async function checkAcpx(options: AcpxCheckOptions = {}): Promise<DoctorCheckResult> {
  const runtimePaths = (options.resolveRuntimePaths ?? resolveRuntimePaths)();

  try {
    const config = await (options.loadConfig ?? loadConfig)(runtimePaths.configPath);
    const metadata = (options.resolveAcpxCommandMetadata ?? resolveAcpxCommandMetadata)({
      configuredCommand: config.transport.command,
    });
    const version = await (options.runVersion ?? defaultRunVersion)(metadata.command);

    return {
      id: "acpx",
      label: "acpx",
      severity: "pass",
      summary: `resolved ${metadata.command} (${version})`,
      details: buildDetails(metadata, version, options.verbose),
      metadata: {
        command: metadata.command,
        source: metadata.source,
        version,
      },
    };
  } catch (error) {
    const message = formatError(error);
    const details = [`config path: ${runtimePaths.configPath}`, `error: ${message}`];

    return {
      id: "acpx",
      label: "acpx",
      severity: "fail",
      summary: "acpx version check failed",
      details,
    };
  }
}

function buildDetails(metadata: AcpxCommandMetadata, version: string, verbose?: boolean): string[] {
  const details = [
    `command: ${metadata.command}`,
    `source: ${metadata.source}`,
    `version: ${version}`,
  ];

  if (verbose) {
    details.push(`resolution: ${metadata.explanation}`);
  }

  return details;
}

async function defaultRunVersion(command: string): Promise<string> {
  const spawnSpec = resolveSpawnCommand(command, ["--version"]);

  return await new Promise((resolve, reject) => {
    const child = spawn(spawnSpec.command, spawnSpec.args, {
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";

    child.stdout.on("data", (chunk) => {
      stdout += String(chunk);
    });
    child.stderr.on("data", (chunk) => {
      stderr += String(chunk);
    });
    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) {
        const version = stdout.trim() || stderr.trim();
        if (version.length > 0) {
          resolve(version);
          return;
        }
      }

      reject(new Error(stderr.trim() || stdout.trim() || `acpx --version exited with code ${code ?? 1}`));
    });
  });
}

function formatError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
