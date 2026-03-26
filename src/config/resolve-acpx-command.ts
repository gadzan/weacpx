import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { createRequire } from "node:module";

interface ResolveAcpxCommandOptions {
  configuredCommand?: string;
  platform?: NodeJS.Platform;
  resolvePackageJson?: (id: string) => string;
  readPackageJson?: (path: string) => { bin?: string | Record<string, string> };
}

const require = createRequire(import.meta.url);

export function resolveAcpxCommand(options: ResolveAcpxCommandOptions = {}): string {
  if (options.configuredCommand) {
    return options.configuredCommand;
  }

  const platform = options.platform ?? process.platform;
  const resolvePackageJson =
    options.resolvePackageJson ?? ((id: string) => require.resolve(id));
  const readPackageJson =
    options.readPackageJson ??
    ((path: string) => JSON.parse(readFileSync(path, "utf8")) as { bin?: string | Record<string, string> });

  try {
    const packageJsonPath = resolvePackageJson("acpx/package.json");
    const pkg = readPackageJson(packageJsonPath);
    const binPath =
      typeof pkg.bin === "string"
        ? pkg.bin
        : pkg.bin && typeof pkg.bin.acpx === "string"
          ? pkg.bin.acpx
          : null;

    if (binPath) {
      if (platform === "win32") {
        return resolve(dirname(packageJsonPath), "../.bin/acpx.exe");
      }
      return resolve(dirname(packageJsonPath), binPath);
    }
  } catch {
    // Fall back to PATH resolution below.
  }

  return "acpx";
}
