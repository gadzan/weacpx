import { spawn } from "node:child_process";

import { collectTests } from "./run-tests-lib.mjs";

const root = process.argv[2] ?? "tests/unit";
const testFiles = collectTests(root);

for (const file of testFiles) {
  const code = await runOne(file);
  if (code !== 0) {
    process.exit(code ?? 1);
  }
}

async function runOne(file) {
  return await new Promise((resolve) => {
    const child = spawn("bun", ["test", file], {
      stdio: "inherit",
    });

    child.on("exit", (code, signal) => {
      if (signal) {
        process.kill(process.pid, signal);
        return;
      }
      resolve(code ?? 1);
    });
  });
}
