import path from "node:path";

import type { AgentSessionListResult } from "./types";

export function isUnknownFilterCwdOption(output: string): boolean {
  return /(?:unknown|unrecognized) option/i.test(output) && output.includes("--filter-cwd");
}

export function filterAgentSessionListByCwd(result: AgentSessionListResult, cwd: string): AgentSessionListResult {
  return {
    ...result,
    sessions: result.sessions.filter((session) => session.cwd && sameAgentSessionCwd(session.cwd, cwd)),
  };
}

function sameAgentSessionCwd(left: string, right: string): boolean {
  const normalizedLeft = normalizeAgentSessionCwd(left);
  const normalizedRight = normalizeAgentSessionCwd(right);
  if (isWindowsLikePath(normalizedLeft) || isWindowsLikePath(normalizedRight)) {
    return normalizedLeft.toLowerCase() === normalizedRight.toLowerCase();
  }
  return normalizedLeft === normalizedRight;
}

function normalizeAgentSessionCwd(input: string): string {
  if (isWindowsLikePath(input)) {
    return path.win32.normalize(input).replace(/\\/g, "/");
  }
  return path.posix.normalize(input.replace(/\\/g, "/"));
}

function isWindowsLikePath(input: string): boolean {
  return /^[a-zA-Z]:[\\/]/.test(input) || input.startsWith("\\\\");
}
