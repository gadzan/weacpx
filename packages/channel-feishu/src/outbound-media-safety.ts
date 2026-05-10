import fs from "node:fs/promises";
import path from "node:path";

/**
 * Resolve an outbound media file path to a safe absolute realpath.
 * Rejects remote URLs, non-existent paths, symlinks that escape allowed roots,
 * and paths outside all allowed root directories.
 * Returns the resolved realpath on success, or null on rejection.
 */
export async function resolveSafeOutboundMediaPath(
  mediaPath: string,
  allowedRoots: string[],
): Promise<string | null> {
  if (mediaPath.startsWith("http://") || mediaPath.startsWith("https://")) {
    return null;
  }

  const candidate = path.isAbsolute(mediaPath) ? mediaPath : path.resolve(mediaPath);
  const realCandidate = await realpathOrNull(candidate);
  if (!realCandidate) {
    return null;
  }

  const stat = await fs.stat(realCandidate).catch(() => null);
  if (!stat?.isFile()) {
    return null;
  }

  for (const root of allowedRoots) {
    const realRoot = await realpathOrNull(root);
    if (realRoot && isPathInside(realCandidate, realRoot)) {
      return realCandidate;
    }
  }

  return null;
}

async function realpathOrNull(filePath: string): Promise<string | null> {
  try {
    return await fs.realpath(filePath);
  } catch {
    return null;
  }
}

function isPathInside(candidate: string, root: string): boolean {
  const relative = path.relative(root, candidate);
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}
