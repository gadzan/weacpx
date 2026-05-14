import fs from "node:fs";

export function ensureDirSync(dir: string): void {
  try {
    fs.mkdirSync(dir, { recursive: true });
    return;
  } catch (err) {
    try {
      if (fs.statSync(dir).isDirectory()) return;
    } catch {
      // Preserve the original mkdir error when the target cannot be statted.
    }
    throw err;
  }
}
