import { spawn } from "node:child_process";

import { buildTestPlan } from "./run-tests-lib.mjs";

const root = process.argv[2] ?? "tests/unit";
const plan = buildTestPlan(root);

for (const step of plan) {
  const code = await runOne(step.command, step.args);
  if (code !== 0) {
    process.exit(code ?? 1);
  }
}

async function runOne(command, args) {
  return await new Promise((resolve) => {
    const child = spawn(command, args, {
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
