import { spawn } from "node:child_process";

import { buildTestPlan } from "./run-tests-lib.mjs";

const root = process.argv[2] ?? "tests/unit";

// Channel-package tests import `packages/*/src`, which value-import the bare
// specifier "weacpx/plugin-api". That resolves via the workspace-root exports
// map to `dist/plugin-api.js`, so the bundle MUST exist before any test runs —
// otherwise the import fails with "Cannot find module 'weacpx/plugin-api'".
// (`build:plugin-api` is emitDeclarationOnly and only produces the .d.ts; the
// runnable .js comes from this bun build.) Build it once up front so every test
// entry point — npm test, test:unit, test:smoke, CI publish gates — is
// self-sufficient and order-independent.
const buildCode = await runOne("bun", [
  "build",
  "./src/plugin-api.ts",
  "--outdir",
  "./dist",
  "--target",
  "node",
  "--external",
  "node-pty",
]);
if (buildCode !== 0) {
  process.exit(buildCode ?? 1);
}

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
      ...(process.platform === "win32" ? { shell: true } : {}),
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
