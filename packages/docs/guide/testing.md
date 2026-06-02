# Testing

## Test commands

Run the full default test suite (TypeScript typecheck + all unit tests):

```bash
npm test
```

This is equivalent to:

```bash
npx tsc --noEmit
node ./scripts/run-tests.mjs
```

Run unit tests explicitly (same behavior as `npm test`):

```bash
npm run test:unit
```

Run smoke tests (requires a real environment — see [Smoke tests](#smoke-tests)):

```bash
npm run test:smoke
```

Build the CLI (used for build verification and before running smoke tests):

```bash
bun run build
```

Local dry run (no WeChat account or credentials needed):

```bash
bun run dry-run --chat-key wx:test -- "/status"
```

Pass multiple commands to simulate a conversation sequence:

```bash
bun run dry-run --chat-key wx:test -- "/session new demo --agent codex --ws backend" "/status"
```

## Unit tests

Unit tests live in `tests/unit/` and mirror the `src/` directory structure. They are:

- Stable and repeatable
- Free of external environment dependencies (no real `acpx`, no real WeChat login, no network)
- Run by both `npm test` and `npm run test:unit`

Test files follow the `*.test.ts` naming convention.

`npm test` runs the TypeScript typecheck (`npx tsc --noEmit`) before the tests. If typecheck fails, the tests do not run.

**Rules for new unit tests:**

1. Place new tests in `tests/unit/`, mirroring the `src/` subdirectory of the code under test.
2. Name test files `*.test.ts`.
3. Do not place temporary debugging scripts in the repository root.
4. Do not put real-environment tests into the unit test suite.

## Smoke tests

Smoke tests live in `tests/smoke/` and are not part of the default `npm test` run. They verify real-environment behavior and may require:

- A real `acpx` session
- A real bridge subprocess
- A real WeChat login flow or live chat channel
- External network access, local agent runtime, or QR code scanning

Run smoke tests separately when you have the required environment set up:

```bash
npm run test:smoke
```

**Do not include smoke tests in the default suite.** Environment differences between machines and CI runners make them unsuitable for automatic gating.

## Local dry runs

The dry-run mode simulates a chat conversation without any external credentials. It is the fastest way to verify command routing, session state logic, and response formatting during development:

```bash
bun run dry-run --chat-key wx:test -- "/status"
bun run dry-run --chat-key wx:test -- "/session new demo --agent codex --ws backend" "/status"
```

Each string after `--` is sent as a separate chat message in sequence. The `--chat-key wx:test` flag identifies the simulated chat context.

## Test layout

```text
tests/
  unit/         Default test suite; mirrors src/ structure
  integration/  Reserved for cross-module tests (not yet enforced)
  smoke/        Real-environment tests; not in default run
  helpers/      Shared test utilities, fixture builders, and test-only tools
scripts/
  run-tests.mjs Test runner invoked by npm test
src/            Production code only — no test files here
```

**`tests/integration/`** is reserved for tests that clearly depend on multiple modules cooperating across boundaries and that are not appropriate for `tests/unit/`. It is not currently enforced.

**`tests/helpers/`** holds shared utilities and fixture builders. Small helpers may be inlined in a single test file; extract to `tests/helpers/` when reuse across multiple files becomes apparent.

When adding a new test type in the future, add a subdirectory under `tests/` rather than placing test files back in `src/`.
