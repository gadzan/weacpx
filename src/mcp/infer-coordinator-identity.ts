import { fileURLToPath } from "node:url";

import type { AppConfig } from "../config/types";
import { normalizeWorkspacePath } from "../commands/workspace-path";

export interface McpRootLike {
  uri: string;
  name?: string;
}

export interface InferWorkspaceFromRootsInput {
  roots: McpRootLike[];
  config: Pick<AppConfig, "workspaces">;
}

export interface InferCoordinatorSessionInput {
  clientName?: string;
  workspace?: string;
  instanceId?: string;
}

export function inferWorkspaceFromRoots(input: InferWorkspaceFromRootsInput): string {
  const rootPaths = input.roots
    .map((root) => fileUriToPathOrNull(root.uri))
    .filter((path): path is string => path !== null)
    .map((path) => normalizeWorkspacePath(path));

  if (rootPaths.length === 0) {
    throw new Error("cannot infer workspace from MCP roots; configure --workspace <name>");
  }

  const matchesByRoot = rootPaths.map((rootPath) => {
    const matches = Object.entries(input.config.workspaces).flatMap(([workspace, record]) => {
      const workspacePath = normalizeWorkspacePath(record.cwd);
      return isSameOrDescendantPath(rootPath, workspacePath)
        ? [{ workspace, workspacePath }]
        : [];
    });
    if (matches.length === 0) {
      return null;
    }

    const longestLength = Math.max(...matches.map((match) => match.workspacePath.length));
    const mostSpecific = matches.filter((match) => match.workspacePath.length === longestLength);
    const uniqueWorkspaceNames = [...new Set(mostSpecific.map((match) => match.workspace))];
    if (uniqueWorkspaceNames.length !== 1) {
      throw new Error(
        `MCP roots match multiple workspaces (${uniqueWorkspaceNames.join(", ")}); configure --workspace <name>`,
      );
    }

    return uniqueWorkspaceNames[0]!;
  }).filter((workspace): workspace is string => workspace !== null);

  if (matchesByRoot.length === 0) {
    throw new Error("cannot infer workspace from MCP roots; configure --workspace <name>");
  }

  const uniqueWorkspaceNames = [...new Set(matchesByRoot)];
  if (uniqueWorkspaceNames.length !== 1) {
    throw new Error(
      `MCP roots match multiple workspaces (${uniqueWorkspaceNames.join(", ")}); configure --workspace <name>`,
    );
  }

  return uniqueWorkspaceNames[0]!;
}

export function inferExternalCoordinatorSession(input: InferCoordinatorSessionInput): string {
  const suffix = input.workspace?.trim() || input.instanceId?.trim() || "instance";
  return `external_${sanitizeMcpClientName(input.clientName)}:${suffix}`;
}

function sanitizeMcpClientName(input: string | undefined): string {
  const normalized = (input ?? "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
  return normalized.length > 0 ? normalized : "mcp-host";
}

function fileUriToPathOrNull(uri: string): string | null {
  try {
    if (!uri.startsWith("file://")) {
      return null;
    }
    return fileURLToPath(uri);
  } catch {
    return null;
  }
}

function isSameOrDescendantPath(candidate: string, parent: string): boolean {
  const normalizedCandidate = trimTrailingSlash(candidate);
  const normalizedParent = trimTrailingSlash(parent);
  if (isWindowsLikePath(normalizedCandidate) || isWindowsLikePath(normalizedParent)) {
    const lowerCandidate = normalizedCandidate.toLowerCase();
    const lowerParent = normalizedParent.toLowerCase();
    return lowerCandidate === lowerParent || lowerCandidate.startsWith(`${lowerParent}/`);
  }
  return normalizedCandidate === normalizedParent || normalizedCandidate.startsWith(`${normalizedParent}/`);
}

function trimTrailingSlash(input: string): string {
  return input.length > 1 ? input.replace(/\/+$/g, "") : input;
}

function isWindowsLikePath(input: string): boolean {
  return /^[a-zA-Z]:\//.test(input) || input.startsWith("//");
}
