import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const PACKAGE_NAME = "weacpx";

export function readVersion(moduleUrl: string = import.meta.url): string {
  let dir: string;
  try {
    dir = path.dirname(fileURLToPath(moduleUrl));
  } catch {
    return "unknown";
  }

  const candidates = [
    path.resolve(dir, "..", "package.json"),
    path.resolve(dir, "..", "..", "package.json"),
  ];

  for (const pkgPath of candidates) {
    try {
      const raw = fs.readFileSync(pkgPath, "utf-8");
      const pkg = JSON.parse(raw) as { name?: string; version?: string };
      if (typeof pkg.version === "string" && pkg.name === PACKAGE_NAME) {
        return pkg.version;
      }
    } catch {
      // try next candidate
    }
  }

  return "unknown";
}

/** weacpx 核心版本，派生自 package.json（经 readVersion 动态读取，无硬编码漂移）。 */
export const WEACPX_CORE_VERSION = readVersion();
