import { describe, it, expect } from "bun:test";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

// Path prefixes (repo-relative, forward-slash) that MUST be free of CJK string
// literals. Widen this list as each domain is migrated, then replace with
// ["src/"] in the final flip.
const MIGRATED_PREFIXES = [
  "src/i18n/messages/en/",
  "src/commands/handlers/session-handler.ts",
  "src/commands/handlers/native-session-handler.ts",
  "src/commands/handlers/session-recovery-handler.ts",
  "src/commands/handlers/session-shortcut-handler.ts",
  "src/commands/handlers/workspace-handler.ts",
  "src/commands/handlers/agent-handler.ts",
  "src/commands/handlers/later-handler.ts",
  "src/commands/handlers/orchestration-handler.ts",
  "src/commands/handlers/config-handler.ts",
  "src/commands/handlers/permission-handler.ts",
  "src/scheduled/scheduled-render.ts",
  "src/orchestration/render-delegate-group-result.ts",
  "src/orchestration/build-coordinator-prompt.ts",
  "src/orchestration/worker-prompts.ts",
  "src/commands/handlers/help-handler.ts",
  "src/commands/command-hints.ts",
  "src/commands/command-router.ts",
  "src/commands/translate-acpx-note.ts",
  "src/formatting/render-text.ts",
];

// Match only Han (Chinese) characters. Using \p{Script=Han} (not a raw BMP range)
// is important: above-BMP emoji like 📖🔍💻 are encoded as surrogate pairs whose
// code units fall inside naive CJK BMP ranges and would false-positive. Emoji are
// allowed in catalogs (incl. the English ones); only Han characters are flagged.
const CJK = /\p{Script=Han}/u;

function listTsFiles(dir: string, acc: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    if (entry === "node_modules" || entry === "dist") continue;
    const p = join(dir, entry);
    if (statSync(p).isDirectory()) listTsFiles(p, acc);
    else if (/\.ts$/.test(entry) && !/\.(test|spec)\.ts$/.test(entry)) acc.push(p);
  }
  return acc;
}

// Best-effort: strip /* */ block comments and // line comments, then flag CJK.
function stripComments(src: string): string {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|[^:])\/\/[^\n]*/g, "$1");
}

describe("no hardcoded CJK in migrated paths", () => {
  it("migrated source files contain no CJK string literals", () => {
    const offenders: string[] = [];
    for (const file of listTsFiles("src")) {
      const rel = file.replace(/\\/g, "/");
      if (!MIGRATED_PREFIXES.some((p) => rel.startsWith(p))) continue;
      if (rel.startsWith("src/i18n/messages/zh/")) continue; // the one allowed home for CJK
      const body = stripComments(readFileSync(file, "utf8"));
      if (CJK.test(body)) offenders.push(rel);
    }
    expect(offenders).toEqual([]);
  });
});
