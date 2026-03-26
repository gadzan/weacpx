import { chmod as chmodFs } from "node:fs/promises";
import { dirname, join } from "node:path";

type ChmodFunction = (path: string, mode: number) => Promise<void>;

export function resolveNodePtyHelperPath(
  packageJsonPath: string,
  platform: NodeJS.Platform,
  arch: string,
): string | null {
  if (platform === "win32") {
    return null;
  }

  return join(dirname(packageJsonPath), "prebuilds", `${platform}-${arch}`, "spawn-helper");
}

export async function ensureNodePtyHelperExecutable(
  helperPath: string | null,
  chmod: ChmodFunction = chmodFs,
): Promise<void> {
  if (!helperPath) {
    return;
  }

  try {
    await chmod(helperPath, 0o755);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return;
    }
    throw error;
  }
}
