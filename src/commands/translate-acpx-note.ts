import { t } from "../i18n";

/**
 * Translate an acpx verbose/stderr line into a user-facing hint.
 * Returns null if the line is noise not worth surfacing (empty, pure npm
 * timing/HTTP noise, etc.).
 */
export function translateAcpxNote(raw: string): string | null {
  const line = raw.replace(/^\s*\[acpx\]\s*/, "").trim();
  if (!line) return null;

  // Blacklist: pure npm timing/notice/info/verb noise has no user value.
  // (`npm http` is kept — it signals active download and maps to 📥 below.)
  if (/^npm\s+(timing|notice|info|verb)\b/i.test(line)) return null;

  const builtIn = line.match(/^spawning installed built-in agent\s+(\S+?)(?:@\S+)?\s+via\s+/i);
  if (builtIn) {
    return t().acpxNote.spawnBuiltIn(builtIn[1] ?? "");
  }
  if (/^spawning agent:/i.test(line)) {
    return t().acpxNote.spawnAgent;
  }
  if (
    /\b(npm|pnpm|yarn|bun)\s+(install|add|download|fetch|http)\b/i.test(line) ||
    /\b(downloading|fetching)\b.*\b(tarball|package|deps|dependencies)\b/i.test(line)
  ) {
    return t().acpxNote.downloading;
  }
  if (/\b(extracting|unpacking|installing|linking|building|compiling)\b/i.test(line)) {
    return t().acpxNote.installing;
  }
  if (/\b(initializ\w*|starting up|bootstrap\w*|connecting|handshak\w*)\b/i.test(line)) {
    return t().acpxNote.initializing;
  }
  // Fallback: surface a truncated raw line so the user sees *something* real.
  const truncated = line.length > 80 ? `${line.slice(0, 77)}…` : line;
  return t().acpxNote.fallback(truncated);
}
