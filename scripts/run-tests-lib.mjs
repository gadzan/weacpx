import { readdirSync, statSync } from "node:fs";
import { join, resolve } from "node:path";

export function collectTests(rootDir, listEntries = defaultListEntries) {
  return walk(rootDir, listEntries).map((file) => resolve(file));
}

function walk(dir, listEntries) {
  const files = [];

  for (const entry of listEntries(dir)) {
    const fullPath = join(dir, entry.name);
    if (entry.isDirectory) {
      files.push(...walk(fullPath, listEntries));
      continue;
    }

    if (entry.name.endsWith(".test.ts")) {
      files.push(fullPath);
    }
  }

  return files;
}

function defaultListEntries(dir) {
  return readdirSync(dir)
    .sort()
    .map((name) => {
      const fullPath = join(dir, name);
      return {
        name,
        isDirectory: statSync(fullPath).isDirectory(),
      };
    });
}
