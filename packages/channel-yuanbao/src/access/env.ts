import os from "node:os";
import { readFileSync } from "node:fs";

let packageVersion: string | null = null;

function getPackageVersion(): string {
  if (packageVersion) return packageVersion;
  try {
    const raw = readFileSync(new URL("../../../package.json", import.meta.url), "utf8");
    const parsed = JSON.parse(raw) as { version?: string };
    packageVersion = parsed.version ?? "0.0.0";
  } catch {
    packageVersion = "0.0.0";
  }
  return packageVersion;
}

export function getPluginVersion(): string {
  return getPackageVersion();
}

export function getOpenclawVersion(): string {
  return getPackageVersion();
}

export function getOperationSystem(): string {
  return `${os.platform()} ${os.release()}`;
}
