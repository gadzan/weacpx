import { describe, it, expect } from "bun:test";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, resolve } from "node:path";

// Root of the channel-yuanbao package source tree.
const PACKAGE_SRC = resolve(import.meta.dir, "../../../../packages/channel-yuanbao/src");

// The ONLY file allowed to contain CJK string literals.
const ZH_CATALOG = resolve(PACKAGE_SRC, "i18n/zh.ts");

// Match only Han (Chinese) characters — same regex as the core guard.
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

describe("no hardcoded CJK in channel-yuanbao/src (except zh.ts)", () => {
  it("only zh.ts contains CJK string literals", () => {
    const offenders: string[] = [];
    for (const file of listTsFiles(PACKAGE_SRC)) {
      if (resolve(file) === ZH_CATALOG) continue; // zh.ts is allowed
      const body = stripComments(readFileSync(file, "utf8"));
      if (CJK.test(body)) offenders.push(file.replace(PACKAGE_SRC, "packages/channel-yuanbao/src"));
    }
    expect(offenders).toEqual([]);
  });
});
