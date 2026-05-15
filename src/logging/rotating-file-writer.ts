import { readdir, rename, rm, stat } from "node:fs/promises";
import { basename, dirname, join } from "node:path";

export async function rotateIfNeeded(
  filePath: string,
  incomingSize: number,
  maxSizeBytes: number,
  maxFiles: number,
): Promise<void> {
  let currentSize = 0;
  try {
    currentSize = (await stat(filePath)).size;
  } catch (error) {
    if (!isMissingFileError(error)) {
      throw error;
    }
  }

  if (currentSize + incomingSize <= maxSizeBytes) {
    return;
  }

  if (currentSize === 0) {
    return;
  }

  if (maxFiles <= 0) {
    await rm(filePath, { force: true });
    return;
  }

  await rm(`${filePath}.${maxFiles}`, { force: true });
  for (let index = maxFiles - 1; index >= 1; index -= 1) {
    const source = `${filePath}.${index}`;
    try {
      await rename(source, `${filePath}.${index + 1}`);
    } catch (error) {
      if (!isMissingFileError(error)) {
        throw error;
      }
    }
  }

  await rename(filePath, `${filePath}.1`);
}

export async function cleanupExpiredRotatedLogs(
  filePath: string,
  retentionDays: number,
  now: () => Date,
): Promise<void> {
  const parentDir = dirname(filePath);
  const prefix = `${basename(filePath)}.`;
  const cutoff = now().getTime() - retentionDays * 24 * 60 * 60 * 1000;

  let files: string[] = [];
  try {
    files = await readdir(parentDir);
  } catch (error) {
    if (isMissingFileError(error)) {
      return;
    }
    throw error;
  }

  for (const file of files) {
    if (!file.startsWith(prefix) || !/^\d+$/.test(file.slice(prefix.length))) {
      continue;
    }

    const candidate = join(parentDir, file);
    const details = await stat(candidate);
    if (details.mtime.getTime() < cutoff) {
      await rm(candidate, { force: true });
    }
  }
}

function isMissingFileError(error: unknown): error is NodeJS.ErrnoException {
  return typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT";
}
