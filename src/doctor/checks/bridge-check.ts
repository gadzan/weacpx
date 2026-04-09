import { loadConfig } from "../../config/load-config";
import { resolveAcpxCommandMetadata, type AcpxCommandMetadata } from "../../config/resolve-acpx-command";
import type { AppConfig } from "../../config/types";
import { resolveBridgeEntryPath, resolveRuntimePaths, type RuntimePaths } from "../../main";
import {
  spawnAcpxBridgeClient,
  type ManagedBridgeClient,
} from "../../transport/acpx-bridge/acpx-bridge-client";
import type { DoctorCheckResult } from "../doctor-types";

export interface BridgeCheckOptions {
  verbose?: boolean;
  cwd?: string;
  resolveRuntimePaths?: () => RuntimePaths;
  loadConfig?: (configPath: string) => Promise<AppConfig>;
  resolveAcpxCommandMetadata?: (options: { configuredCommand?: string }) => AcpxCommandMetadata;
  resolveBridgeEntryPath?: () => string;
  spawnAcpxBridgeClient?: (options: {
    acpxCommand?: string;
    bridgeEntryPath?: string;
    cwd?: string;
    permissionMode?: string;
    nonInteractivePermissions?: string;
  }) => Promise<ManagedBridgeClient>;
}

export async function checkBridge(options: BridgeCheckOptions = {}): Promise<DoctorCheckResult> {
  const runtimePaths = (options.resolveRuntimePaths ?? resolveRuntimePaths)();

  try {
    const config = await (options.loadConfig ?? loadConfig)(runtimePaths.configPath);
    if (config.transport.type === "acpx-cli") {
      return {
        id: "bridge",
        label: "Bridge",
        severity: "skip",
        summary: "bridge check skipped for acpx-cli transport",
      };
    }

    const metadata = (options.resolveAcpxCommandMetadata ?? resolveAcpxCommandMetadata)({
      configuredCommand: config.transport.command,
    });
    const client = await (options.spawnAcpxBridgeClient ?? spawnAcpxBridgeClient)({
      acpxCommand: metadata.command,
      bridgeEntryPath: (options.resolveBridgeEntryPath ?? resolveBridgeEntryPath)(),
      cwd: options.cwd ?? process.cwd(),
      permissionMode: config.transport.permissionMode,
      nonInteractivePermissions: config.transport.nonInteractivePermissions,
    });

    try {
      return {
        id: "bridge",
        label: "Bridge",
        severity: "pass",
        summary: "bridge responded to ping",
        details: buildDetails(metadata, options.verbose),
        metadata: {
          acpxCommand: metadata.command,
          source: metadata.source,
        },
      };
    } finally {
      await client.dispose();
    }
  } catch (error) {
    return {
      id: "bridge",
      label: "Bridge",
      severity: "fail",
      summary: "bridge startup failed",
      details: [`config path: ${runtimePaths.configPath}`, `error: ${formatError(error)}`],
    };
  }
}

function buildDetails(metadata: AcpxCommandMetadata, verbose?: boolean): string[] | undefined {
  const details = [`acpx command: ${metadata.command}`, `source: ${metadata.source}`];

  if (verbose) {
    details.push(`resolution: ${metadata.explanation}`);
  }

  return details;
}

function formatError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
