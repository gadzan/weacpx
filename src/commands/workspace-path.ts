import { access } from "node:fs/promises";

import {
  normalizePath,
  basenameForPath,
  isSamePath,
} from "../util/path.js";

export function normalizeWorkspacePath(input: string): string {
  return normalizePath(input);
}

export function basenameForWorkspacePath(input: string): string {
  return basenameForPath(input);
}

export function sameWorkspacePath(left: string, right: string): boolean {
  return isSamePath(left, right);
}

export async function pathExists(filePath: string): Promise<boolean> {
  try {
    await access(filePath);
    return true;
  } catch {
    return false;
  }
}
