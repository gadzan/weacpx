export function resolveAgentCommand(
  driver: string,
  command: string | undefined,
): string | undefined {
  if (!command) {
    return undefined;
  }

  if (driver === "codex" && isLegacyCodexCommand(command)) {
    return undefined;
  }

  return command;
}

export function isLegacyCodexCommand(command: string): boolean {
  const normalized = command.trim().replaceAll("\\", "/").toLowerCase();

  return (
    normalized === "./node_modules/.bin/codex-acp" ||
    normalized === "./node_modules/.bin/codex-acp.exe" ||
    normalized.endsWith("/node_modules/.bin/codex-acp") ||
    normalized.endsWith("/node_modules/.bin/codex-acp.exe") ||
    normalized.includes("/@zed-industries/codex-acp/bin/codex-acp.js") ||
    normalized.includes("@zed-industries/codex-acp/bin/codex-acp.js")
  );
}
