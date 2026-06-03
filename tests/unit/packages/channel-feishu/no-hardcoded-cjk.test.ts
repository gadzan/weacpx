import { describe, it, expect } from "bun:test";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

const PACKAGE_SRC = "packages/channel-feishu/src";

// Match Han (Chinese) characters using Unicode script property.
// Using \p{Script=Han} (not a raw BMP range) avoids false-positives from
// emoji surrogate-pair code units that fall inside naive CJK BMP ranges.
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

describe("no hardcoded CJK in channel-feishu/src (except zh catalog)", () => {
  it("all source files are free of CJK string literals", () => {
    const offenders: string[] = [];
    for (const file of listTsFiles(PACKAGE_SRC)) {
      const rel = file.replace(/\\/g, "/");
      // The only allowed home for CJK literals is the zh catalog file.
      if (rel.endsWith("packages/channel-feishu/src/i18n/zh.ts")) continue;
      const body = stripComments(readFileSync(file, "utf8"));
      if (CJK.test(body)) offenders.push(rel);
    }
    expect(offenders).toEqual([]);
  });
});
