import { access } from "node:fs/promises";
import { homedir } from "node:os";
import path from "node:path";

const WINDOWS_DRIVE_PATH_RE = /^[a-zA-Z]:[\\/]/;
const WINDOWS_UNC_PATH_RE = /^\\\\/;
const ROOT_PATH_RE = /^(\/|[a-zA-Z]:\/?)$/;

export function normalizeWorkspacePath(input: string): string {
  const expanded = expandHome(input);
  if (isWindowsLikePath(expanded)) {
    return path.win32.normalize(expanded).replace(/\\/g, "/");
  }

  return path.posix.normalize(expanded.replace(/\\/g, "/"));
}

export function basenameForWorkspacePath(input: string): string {
  const normalized = normalizeWorkspacePath(input);
  if (ROOT_PATH_RE.test(normalized)) {
    return normalized;
  }
  const base = path.posix.basename(normalized);
  return base || normalized;
}

export function sameWorkspacePath(left: string, right: string): boolean {
  const normalizedLeft = normalizeWorkspacePath(left);
  const normalizedRight = normalizeWorkspacePath(right);

  if (isWindowsLikePath(normalizedLeft) || isWindowsLikePath(normalizedRight)) {
    return normalizedLeft.toLowerCase() === normalizedRight.toLowerCase();
  }

  return normalizedLeft === normalizedRight;
}

function expandHome(input: string): string {
  return input.startsWith("~") ? homedir() + input.slice(1) : input;
}

export async function pathExists(filePath: string): Promise<boolean> {
  try {
    await access(filePath);
    return true;
  } catch {
    return false;
  }
}

function isWindowsLikePath(input: string): boolean {
  return WINDOWS_DRIVE_PATH_RE.test(input) || WINDOWS_UNC_PATH_RE.test(input);
}
