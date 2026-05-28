import path from "node:path";
import { homedir } from "node:os";

const WINDOWS_DRIVE_PATH_RE = /^[a-zA-Z]:[\\/]/;
const WINDOWS_UNC_PATH_RE = /^\\\\/;
const ROOT_PATH_RE = /^(\/|[a-zA-Z]:\/?)$/;

export function normalizePath(input: string): string {
  const expanded = expandHome(input);
  if (isWindowsLikePath(expanded)) {
    return path.win32.normalize(expanded).replace(/\\/g, "/");
  }
  return path.posix.normalize(expanded.replace(/\\/g, "/"));
}

export function basenameForPath(input: string): string {
  const normalized = normalizePath(input);
  if (ROOT_PATH_RE.test(normalized)) {
    return normalized;
  }
  const base = path.posix.basename(normalized);
  return base || normalized;
}

export function isSamePath(left: string, right: string): boolean {
  const normalizedLeft = normalizePath(left);
  const normalizedRight = normalizePath(right);

  if (isWindowsLikePath(normalizedLeft) || isWindowsLikePath(normalizedRight)) {
    return normalizedLeft.toLowerCase() === normalizedRight.toLowerCase();
  }

  return normalizedLeft === normalizedRight;
}

export function isWindowsLikePath(input: string): boolean {
  return WINDOWS_DRIVE_PATH_RE.test(input) || WINDOWS_UNC_PATH_RE.test(input);
}

function expandHome(input: string): string {
  return input.startsWith("~") ? homedir() + input.slice(1) : input;
}
