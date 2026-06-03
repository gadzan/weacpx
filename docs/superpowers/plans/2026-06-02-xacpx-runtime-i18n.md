# xacpx Runtime i18n Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make every runtime user-facing string translatable behind a single global locale (`en` | `zh`) chosen by `config.language`, defaulting to the system locale, with compiler-enforced catalog parity and a guard that stops new hard-coded Chinese.

**Architecture:** A dependency-free `src/i18n/` module exposes a typed `Messages` contract, one implementation per locale split into per-domain files, and a `setLocale`/`t()` runtime set once per process entrypoint. Strings are migrated domain-by-domain: the Chinese literal becomes the `zh` catalog value verbatim, its English translation becomes the `en` value, and the call site becomes `t().<domain>.<key>`. A unit-test guard fails on CJK string literals in migrated paths and is widened until it covers the whole `src/` tree (minus the `zh` catalog).

**Tech Stack:** TypeScript, Bun (test runner `bun test`), existing `ConfigStore`/`loadConfig` config layer.

**Spec:** `docs/superpowers/specs/2026-06-02-xacpx-runtime-i18n-design.md`

---

## File Structure

**New (foundation):**
- `src/i18n/resolve-locale.ts` — `Locale` type, `isLocale`, pure `resolveLocale({configLanguage, env})`.
- `src/i18n/types.ts` — the `Messages` interface (the contract). Grows one namespace per domain task.
- `src/i18n/index.ts` — runtime: `setLocale`, `getLocale`, `t()`, re-exports.
- `src/i18n/messages/en/index.ts`, `src/i18n/messages/zh/index.ts` — aggregate per-domain files into `const en: Messages` / `const zh: Messages`.
- `src/i18n/messages/{en,zh}/<domain>.ts` — per-domain catalogs (added per migration task).
- `tests/unit/i18n/resolve-locale.test.ts`, `tests/unit/i18n/runtime.test.ts`, `tests/unit/i18n/no-hardcoded-cjk.test.ts`.

**Modified (foundation):**
- `src/config/types.ts` — add `language?: Locale` to `AppConfig`.
- `src/config/load-config.ts` — parse/validate `language` in `parseConfig`.
- `src/commands/handlers/config-handler.ts` — add `language` to the `/config set` whitelist + apply case.
- `src/cli.ts`, `src/main.ts`, `src/bridge/bridge-main.ts` — resolve + `setLocale` at each entrypoint; propagate `XACPX_LANG` to children.

**Modified (per domain migration):** the handler/CLI/render files listed in each migration task (Tasks 6–18).

---

## Migration Recipe (referenced by every domain task)

This is the exact, self-contained procedure each domain task applies. "Domain `D`, files `F…`, namespace `D`":

1. **Add the namespace to the contract.** In `src/i18n/types.ts`, add `export interface DMessages { … }` with one member per string in `F…`: a `string` for static text, a typed function `(args) => string` for any string built with interpolation. Add `D: DMessages;` to `interface Messages`.
2. **Create `src/i18n/messages/zh/D.ts`.** `export const D: DMessages = { … }` where each value is the **current Chinese literal copied verbatim** from `F…` (functions wrap the existing template).
3. **Create `src/i18n/messages/en/D.ts`.** Same keys; each value is a **faithful English translation** of the zh value (same placeholders/order). For agent-prompt domains, port meaning exactly — behavior-preserving, no wording "improvements" in this pass.
4. **Register the domain.** Add `import { D } from "./D"` and `D` to the object in both `src/i18n/messages/en/index.ts` and `src/i18n/messages/zh/index.ts`. (Both are typed `Messages`, so a missing/renamed key fails `bun run build` / `npx tsc --noEmit`.)
5. **Replace call sites in `F…`.** Delete the inline Chinese literal; call `t().D.key` (static) or `t().D.key(args)` (parameterized). **Never** assign a catalog value to a module-level `const` — read `t()` inside the function body so the active locale is current. Convert any module-level help/usage constants to functions/getters that read `t()` lazily.
6. **Point tests at the catalog.** In tests that asserted the old Chinese text, call `setLocale("zh")` (or `"en"`) in setup and assert against `t().D.key(...)` instead of a re-typed literal.
7. **Widen the guard.** Add the migrated source globs (`F…`) to `MIGRATED_GLOBS` in `tests/unit/i18n/no-hardcoded-cjk.test.ts`.
8. **Verify + commit.** `npx tsc --noEmit && bun test tests/unit/i18n tests/unit/<domain-tests>` green, then commit.

Task 6 (session) below is the fully worked reference for this recipe.

---

## Task 1: i18n core module (resolver, contract, runtime)

**Files:**
- Create: `src/i18n/resolve-locale.ts`
- Create: `src/i18n/types.ts`
- Create: `src/i18n/messages/en/common.ts`, `src/i18n/messages/en/index.ts`
- Create: `src/i18n/messages/zh/common.ts`, `src/i18n/messages/zh/index.ts`
- Create: `src/i18n/index.ts`
- Test: `tests/unit/i18n/resolve-locale.test.ts`, `tests/unit/i18n/runtime.test.ts`

- [ ] **Step 1: Write the failing resolver test**

`tests/unit/i18n/resolve-locale.test.ts`:

```ts
import { describe, it, expect } from "bun:test";
import { resolveLocale, isLocale } from "../../../src/i18n/resolve-locale";

describe("resolveLocale", () => {
  it("prefers a valid config language", () => {
    expect(resolveLocale({ configLanguage: "zh", env: { LANG: "en_US.UTF-8" } })).toBe("zh");
  });
  it("ignores an invalid config language and falls back to env", () => {
    expect(resolveLocale({ configLanguage: "fr", env: { LANG: "en_US.UTF-8" } })).toBe("en");
  });
  it("detects zh from LANG", () => {
    expect(resolveLocale({ env: { LANG: "zh_CN.UTF-8" } })).toBe("zh");
  });
  it("prefers LC_ALL over LANG", () => {
    expect(resolveLocale({ env: { LC_ALL: "zh_CN.UTF-8", LANG: "en_US.UTF-8" } })).toBe("zh");
  });
  it("defaults to en when nothing matches", () => {
    expect(resolveLocale({ env: {} })).toBe("en");
  });
  it("isLocale guards values", () => {
    expect(isLocale("en")).toBe(true);
    expect(isLocale("zh")).toBe(true);
    expect(isLocale("fr")).toBe(false);
    expect(isLocale(undefined)).toBe(false);
  });
});
```

- [ ] **Step 2: Run it; verify it fails**

Run: `bun test tests/unit/i18n/resolve-locale.test.ts`
Expected: FAIL — cannot find module `resolve-locale`.

- [ ] **Step 3: Implement the resolver**

`src/i18n/resolve-locale.ts`:

```ts
export type Locale = "en" | "zh";

const VALID = ["en", "zh"] as const;

export function isLocale(value: unknown): value is Locale {
  return typeof value === "string" && (VALID as readonly string[]).includes(value);
}

export function resolveLocale(
  input: { configLanguage?: string; env?: NodeJS.ProcessEnv } = {},
): Locale {
  const { configLanguage, env = process.env } = input;
  if (isLocale(configLanguage)) return configLanguage;
  const raw = env.LC_ALL || env.LC_MESSAGES || env.LANG || "";
  return /^zh/i.test(raw) ? "zh" : "en";
}
```

- [ ] **Step 4: Run the resolver test; verify it passes**

Run: `bun test tests/unit/i18n/resolve-locale.test.ts`
Expected: PASS (6 assertions).

- [ ] **Step 5: Create the contract + seed `common` domain**

`src/i18n/types.ts`:

```ts
export interface CommonMessages {
  localeName: string;
}

export interface Messages {
  common: CommonMessages;
}
```

`src/i18n/messages/en/common.ts`:

```ts
import type { CommonMessages } from "../../types";

export const common: CommonMessages = {
  localeName: "English",
};
```

`src/i18n/messages/zh/common.ts`:

```ts
import type { CommonMessages } from "../../types";

export const common: CommonMessages = {
  localeName: "中文",
};
```

`src/i18n/messages/en/index.ts`:

```ts
import type { Messages } from "../../types";
import { common } from "./common";

export const en: Messages = { common };
```

`src/i18n/messages/zh/index.ts`:

```ts
import type { Messages } from "../../types";
import { common } from "./common";

export const zh: Messages = { common };
```

- [ ] **Step 6: Implement the runtime**

`src/i18n/index.ts`:

```ts
import type { Locale } from "./resolve-locale";
import type { Messages } from "./types";
import { en } from "./messages/en";
import { zh } from "./messages/zh";

export type { Locale } from "./resolve-locale";
export { resolveLocale, isLocale } from "./resolve-locale";
export type { Messages } from "./types";

let active: Messages = en;
let activeLocale: Locale = "en";

export function setLocale(locale: Locale): void {
  activeLocale = locale;
  active = locale === "zh" ? zh : en;
}

export function getLocale(): Locale {
  return activeLocale;
}

export function t(): Messages {
  return active;
}
```

- [ ] **Step 7: Write the runtime test**

`tests/unit/i18n/runtime.test.ts`:

```ts
import { describe, it, expect, afterEach } from "bun:test";
import { setLocale, getLocale, t } from "../../../src/i18n";

afterEach(() => setLocale("en"));

describe("i18n runtime", () => {
  it("defaults to en", () => {
    expect(getLocale()).toBe("en");
    expect(t().common.localeName).toBe("English");
  });
  it("switches to zh", () => {
    setLocale("zh");
    expect(getLocale()).toBe("zh");
    expect(t().common.localeName).toBe("中文");
  });
});
```

- [ ] **Step 8: Run i18n tests + typecheck**

Run: `npx tsc --noEmit && bun test tests/unit/i18n`
Expected: PASS, no type errors.

- [ ] **Step 9: Commit**

```bash
git add src/i18n tests/unit/i18n
git commit -m "feat(i18n): add locale resolver, typed Messages contract, and runtime"
```

---

## Task 2: `config.language` field + `/config set` whitelist

**Files:**
- Modify: `src/config/types.ts:89` (AppConfig)
- Modify: `src/config/load-config.ts` (`parseConfig`)
- Modify: `src/commands/handlers/config-handler.ts` (whitelist + apply switch)
- Test: `tests/unit/config/load-config.test.ts` (or the existing load-config test file)

- [ ] **Step 1: Write the failing config-parse test**

Add to the load-config test file:

```ts
import { setLocale } from "../../../src/i18n";

it("parses a valid language field", () => {
  const cfg = parseConfig({ language: "zh" });
  expect(cfg.language).toBe("zh");
});
it("drops an invalid language field", () => {
  const cfg = parseConfig({ language: "fr" });
  expect(cfg.language).toBeUndefined();
});
```

(Adjust the `parseConfig` import to match the existing test file's imports.)

- [ ] **Step 2: Run it; verify it fails**

Run: `bun test tests/unit/config/load-config.test.ts`
Expected: FAIL — `language` not on parsed config.

- [ ] **Step 3: Add the field to `AppConfig`**

In `src/config/types.ts`, add the import and field:

```ts
import type { Locale } from "../i18n/resolve-locale";

export interface AppConfig {
  transport: TransportConfig;
  logging: LoggingConfig;
  channel: ChannelConfig;
  channels: ChannelRuntimeConfig[];
  plugins: PluginConfig[];
  agents: Record<string, AgentConfig>;
  workspaces: Record<string, WorkspaceConfig>;
  orchestration: OrchestrationConfig;
  later?: LaterConfig;
  language?: Locale;
}
```

- [ ] **Step 4: Parse it in `parseConfig`**

In `src/config/load-config.ts`, add the import and, inside `parseConfig` where the result object is assembled, set `language`:

```ts
import { isLocale } from "../i18n/resolve-locale";

// inside parseConfig, when building the returned AppConfig:
const language = isRecord(raw) && isLocale((raw as Record<string, unknown>).language)
  ? ((raw as Record<string, unknown>).language as Locale)
  : undefined;

// then include in the returned object:
//   ...(language ? { language } : {}),
```

(Import `Locale` as a type in this file too: `import type { Locale } from "../i18n/resolve-locale";`.)

- [ ] **Step 5: Run the parse test; verify it passes**

Run: `bun test tests/unit/config/load-config.test.ts`
Expected: PASS.

- [ ] **Step 6: Add `language` to the `/config set` whitelist**

In `src/commands/handlers/config-handler.ts`, add `"language"` to `SUPPORTED_CONFIG_PATHS`:

```ts
const SUPPORTED_CONFIG_PATHS = [
  "language",
  "transport.type",
  // …unchanged…
];
```

And add an apply case in the path switch (use a plain English error literal — the config domain catalog is migrated later in Task 12; English literals pass the CJK guard):

```ts
case "language": {
  if (!isLocale(rawValue)) return { error: "language only supports: en, zh" };
  config.language = rawValue;
  break;
}
```

Add `import { isLocale } from "../../i18n/resolve-locale";` to the file.

- [ ] **Step 7: Write the whitelist apply test**

Add to the config-handler test file:

```ts
it("sets language via /config set", () => {
  const result = applyConfigSet(cloneAppConfig(baseConfig), "language", "zh");
  expect("error" in result).toBe(false);
  // assert config.language === "zh" via the handler's return shape
});
```

(Match the existing config-handler test's helper/return conventions.)

- [ ] **Step 8: Run config tests + typecheck**

Run: `npx tsc --noEmit && bun test tests/unit/config tests/unit/commands/handlers/config-handler.test.ts`
Expected: PASS.

- [ ] **Step 9: Commit**

```bash
git add src/config tests/unit/config src/commands/handlers/config-handler.ts tests/unit/commands/handlers/config-handler.test.ts
git commit -m "feat(i18n): add config.language field and /config set language"
```

---

## Task 3: Locale bootstrap at every entrypoint

**Files:**
- Modify: `src/cli.ts` (top of `runCli`)
- Modify: `src/main.ts` (`buildApp` after config load; `reloadRuntimeConfig`)
- Modify: `src/bridge/bridge-main.ts` (startup)
- Test: `tests/unit/i18n/bootstrap.test.ts`

- [ ] **Step 1: Write the failing CLI-bootstrap test**

`tests/unit/i18n/bootstrap.test.ts`:

```ts
import { describe, it, expect, afterEach } from "bun:test";
import { setLocale, getLocale, resolveLocale } from "../../../src/i18n";

afterEach(() => setLocale("en"));

describe("entrypoint locale bootstrap", () => {
  it("resolveLocale drives setLocale from config language", () => {
    setLocale(resolveLocale({ configLanguage: "zh", env: {} }));
    expect(getLocale()).toBe("zh");
  });
  it("falls back to system locale when config language absent", () => {
    setLocale(resolveLocale({ configLanguage: undefined, env: { LANG: "zh_CN.UTF-8" } }));
    expect(getLocale()).toBe("zh");
  });
});
```

- [ ] **Step 2: Run it; verify it passes the unit-level contract**

Run: `bun test tests/unit/i18n/bootstrap.test.ts`
Expected: PASS (this locks the contract the entrypoints must call).

- [ ] **Step 3: Bootstrap in the CLI**

At the very top of `runCli(args, deps)` in `src/cli.ts` (before any `print`/`HELP_LINES` output), add:

```ts
import { setLocale, resolveLocale } from "./i18n";
import { loadConfig } from "./config/load-config";

// first lines of runCli:
{
  let configLanguage: string | undefined;
  try {
    const paths = (await import("./main")).resolveRuntimePaths();
    configLanguage = (await loadConfig(paths.configPath)).language;
  } catch {
    // no config yet (e.g. first run / xacpx login) — fall back to system locale
  }
  setLocale(resolveLocale({ configLanguage }));
}
```

- [ ] **Step 4: Bootstrap in the daemon**

In `src/main.ts` `buildApp`, immediately after `const config = await loadConfig(...)` (line ~153), add `setLocale(resolveLocale({ configLanguage: config.language }))`. In `reloadRuntimeConfig`, after loading `updated`, also call `setLocale(resolveLocale({ configLanguage: updated.language }))`. Add `import { setLocale, resolveLocale, getLocale } from "./i18n";`.

- [ ] **Step 5: Propagate `XACPX_LANG` to child processes**

Wherever the daemon spawns acpx/bridge/queue-owner/mcp children with an `env`, add `XACPX_LANG: getLocale()`. Concretely, at `src/cli.ts:1213` (`env: process.env`) and any bridge/queue-owner spawn env in the transport layer, merge `{ ...process.env, XACPX_LANG: getLocale() }`. In the `mcp-stdio` case (`src/cli.ts:420`), bootstrap from the env var first:

```ts
setLocale(resolveLocale({ configLanguage: process.env.XACPX_LANG }));
```

- [ ] **Step 6: Bootstrap in the bridge subprocess**

At the start of `src/bridge/bridge-main.ts`'s main entry, add:

```ts
import { setLocale, resolveLocale } from "../i18n";
setLocale(resolveLocale({ configLanguage: process.env.XACPX_LANG }));
```

- [ ] **Step 7: Typecheck + full unit suite**

Run: `npx tsc --noEmit && bun test`
Expected: PASS (no behavior change yet — only locale is set; all strings are still inline).

- [ ] **Step 8: Commit**

```bash
git add src/cli.ts src/main.ts src/bridge/bridge-main.ts tests/unit/i18n/bootstrap.test.ts
git commit -m "feat(i18n): resolve and set locale at CLI, daemon, bridge, and mcp-stdio entrypoints"
```

---

## Task 4: No-hardcoded-CJK regression guard

**Files:**
- Create: `tests/unit/i18n/no-hardcoded-cjk.test.ts`

- [ ] **Step 1: Write the guard test (scoped to the en catalog initially)**

`tests/unit/i18n/no-hardcoded-cjk.test.ts`:

```ts
import { describe, it, expect } from "bun:test";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

// Globs (prefix match against repo-relative path) that MUST be free of CJK
// string literals. Widen this list as each domain is migrated (Tasks 6–18),
// then replace with ["src/"] in the final flip (Task 19).
const MIGRATED_PREFIXES = ["src/i18n/messages/en/"];

const CJK = /[㐀-鿿豈-﫿]/;

function listTsFiles(dir: string, acc: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    if (entry === "node_modules" || entry === "dist") continue;
    const p = join(dir, entry);
    if (statSync(p).isDirectory()) listTsFiles(p, acc);
    else if (/\.ts$/.test(entry) && !/\.(test|spec)\.ts$/.test(entry)) acc.push(p);
  }
  return acc;
}

// Remove // line comments and /* */ block comments (best-effort), then flag CJK.
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
      if (rel.startsWith("src/i18n/messages/zh/")) continue; // the one allowed home
      const body = stripComments(readFileSync(file, "utf8"));
      if (CJK.test(body)) offenders.push(rel);
    }
    expect(offenders).toEqual([]);
  });
});
```

- [ ] **Step 2: Run it; verify it passes**

Run: `bun test tests/unit/i18n/no-hardcoded-cjk.test.ts`
Expected: PASS (only `src/i18n/messages/en/**` is in scope and it is English-only).

- [ ] **Step 3: Commit**

```bash
git add tests/unit/i18n/no-hardcoded-cjk.test.ts
git commit -m "test(i18n): add no-hardcoded-CJK guard (scoped to en catalog)"
```

---

## Task 5: Migration ordering reference

The remaining tasks each apply the **Migration Recipe** above to one domain. Order is chosen so leaf/standalone domains go first and the largest (orchestration) lands mid-way. Each task: add the namespace to `types.ts`, create `en/<domain>.ts` + `zh/<domain>.ts`, register in both `index.ts`, replace call sites, update tests, widen `MIGRATED_PREFIXES`, then `npx tsc --noEmit && bun test` and commit.

Task 6 (session) is fully worked as the canonical example; Tasks 7–18 list their concrete source files and namespace and follow the identical recipe.

---

## Task 6: Migrate `session` domain (worked reference)

**Files:**
- Modify: `src/i18n/types.ts`
- Create: `src/i18n/messages/en/session.ts`, `src/i18n/messages/zh/session.ts`
- Modify: `src/i18n/messages/en/index.ts`, `src/i18n/messages/zh/index.ts`
- Modify: `src/commands/handlers/session-handler.ts`
- Modify: `tests/unit/i18n/no-hardcoded-cjk.test.ts` (widen `MIGRATED_PREFIXES`)
- Test: `tests/unit/commands/handlers/session-handler.test.ts`

- [ ] **Step 1: Add the `session` namespace to the contract**

In `src/i18n/types.ts` add (one member per user-facing string in `session-handler.ts`; example members shown — add the rest from the file):

```ts
export interface SessionMessages {
  noCurrent: string;                          // was: "当前还没有选中的会话。请先执行 /session new ... 或 /use <alias>。"
  helpSummary: string;                        // was: "创建、复用、切换和重置 xacpx 逻辑会话。"
  created: (alias: string) => string;         // was: built from alias
  switched: (alias: string) => string;
  reset: string;
  // …continue: one key per remaining Chinese string in session-handler.ts…
}
```

Add `session: SessionMessages;` to `interface Messages`.

- [ ] **Step 2: Create the zh catalog (verbatim current strings)**

`src/i18n/messages/zh/session.ts`:

```ts
import type { SessionMessages } from "../../types";

export const session: SessionMessages = {
  noCurrent: "当前还没有选中的会话。请先执行 /session new ... 或 /use <alias>。",
  helpSummary: "创建、复用、切换和重置 xacpx 逻辑会话。",
  created: (alias) => `会话 ${alias} 已创建。`,
  switched: (alias) => `已切换到会话 ${alias}。`,
  reset: "当前会话上下文已重置。",
  // …rest, each copied verbatim from session-handler.ts…
};
```

(Copy each value verbatim from the current literals in `session-handler.ts`. The exact text for `created`/`switched`/etc. comes from that file.)

- [ ] **Step 3: Create the en catalog (faithful translation)**

`src/i18n/messages/en/session.ts`:

```ts
import type { SessionMessages } from "../../types";

export const session: SessionMessages = {
  noCurrent: "No session is currently selected. Run /session new ... or /use <alias> first.",
  helpSummary: "Create, reuse, switch, and reset xacpx logical sessions.",
  created: (alias) => `Session ${alias} created.`,
  switched: (alias) => `Switched to session ${alias}.`,
  reset: "The current session context has been reset.",
  // …rest, translating each zh value, same placeholders…
};
```

- [ ] **Step 4: Register the domain in both index files**

In `src/i18n/messages/en/index.ts` and `src/i18n/messages/zh/index.ts`:

```ts
import { session } from "./session";
export const en /* or zh */: Messages = { common, session };
```

- [ ] **Step 5: Replace call sites in `session-handler.ts`**

Add `import { t } from "../../i18n";`. Replace each inline literal. Example:

```ts
// before
const NO_CURRENT_SESSION_TEXT = "当前还没有选中的会话。请先执行 /session new ... 或 /use <alias>。";
// …
return { text: NO_CURRENT_SESSION_TEXT };

// after — delete the const; at the call site:
return { text: t().session.noCurrent };
```

For the help metadata object that is currently a module-level `const` of Chinese strings, convert it to a function that builds from `t()` at call time (so locale is current), e.g. `function sessionHelp() { return { summary: t().session.helpSummary, commands: [ … ] }; }` and call `sessionHelp()` where the const was used.

- [ ] **Step 6: Update the session-handler test to assert via the catalog**

In `tests/unit/commands/handlers/session-handler.test.ts`, import and pin locale:

```ts
import { setLocale, t } from "../../../../src/i18n";
beforeEach(() => setLocale("zh")); // or "en" — match what the suite expects

// replace literal assertions:
expect(result.text).toBe(t().session.noCurrent);
expect(result.text).toBe(t().session.created("backend:codex"));
```

- [ ] **Step 7: Widen the guard**

In `tests/unit/i18n/no-hardcoded-cjk.test.ts`, add to `MIGRATED_PREFIXES`:

```ts
const MIGRATED_PREFIXES = [
  "src/i18n/messages/en/",
  "src/commands/handlers/session-handler.ts",
];
```

- [ ] **Step 8: Typecheck + test**

Run: `npx tsc --noEmit && bun test tests/unit/i18n tests/unit/commands/handlers/session-handler.test.ts`
Expected: PASS. (A missing/renamed key would have failed `tsc`.)

- [ ] **Step 9: Commit**

```bash
git add src/i18n src/commands/handlers/session-handler.ts tests/unit
git commit -m "feat(i18n): migrate session domain to message catalog"
```

---

## Tasks 7–18: Remaining domain migrations

Apply the **Migration Recipe** (and the Task 6 worked example) to each domain below. Each task is one commit: add namespace to `types.ts`, create `en/<domain>.ts` + `zh/<domain>.ts`, register in both index files, replace call sites in the listed files, update the listed tests to assert via the catalog, append the listed source files to `MIGRATED_PREFIXES`, then `npx tsc --noEmit && bun test` green before committing.

- [ ] **Task 7 — `nativeSession`**
  Files: `src/commands/handlers/native-session-handler.ts`, `src/commands/handlers/session-recovery-handler.ts`, `src/commands/handlers/session-shortcut-handler.ts`.
  Tests: the matching `tests/unit/commands/handlers/*` files.
  Commit: `feat(i18n): migrate native-session/recovery/shortcut domain`

- [ ] **Task 8 — `workspace` + `agent`**
  Files: `src/commands/handlers/workspace-handler.ts`, `src/commands/handlers/agent-handler.ts`.
  Tests: matching handler tests.
  Commit: `feat(i18n): migrate workspace and agent domains`

- [ ] **Task 9 — `later` + `scheduledRender`**
  Files: `src/commands/handlers/later-handler.ts`, `src/scheduled/scheduled-render.ts`, `src/scheduled/scheduled-service.ts` (user-facing strings only).
  Tests: `tests/unit/commands/handlers/later-handler.test.ts`, `tests/unit/scheduled/*`.
  Commit: `feat(i18n): migrate later and scheduled-render domains`

- [ ] **Task 10 — `orchestration` (handlers + delegate rendering)**
  Files: `src/commands/handlers/orchestration-handler.ts`, `src/orchestration/render-delegate-group-result.ts`, `src/orchestration/orchestration-service.ts` (user-facing strings only).
  Tests: `tests/unit/commands/handlers/orchestration-handler.test.ts`, `tests/unit/orchestration/*`.
  Commit: `feat(i18n): migrate orchestration handler + delegate rendering`

- [ ] **Task 11 — `orchestrationPrompts` (agent-facing)**
  Files: `src/orchestration/build-coordinator-prompt.ts`, `src/orchestration/worker-prompts.ts`.
  Note: these are large multi-line prompt templates → function-valued catalog entries. Port meaning exactly (behavior-preserving). en = faithful English of the current zh prompt; no wording redesign in this pass.
  Tests: `tests/unit/orchestration/*` that assert prompt content → assert via catalog.
  Commit: `feat(i18n): migrate coordinator/worker agent prompts`

- [ ] **Task 12 — `config` + `permission`**
  Files: `src/commands/handlers/config-handler.ts` (incl. the English `language` error literal from Task 2 → move into catalog), `src/commands/handlers/permission-handler.ts`.
  Tests: matching handler tests.
  Commit: `feat(i18n): migrate config and permission domains`

- [ ] **Task 13 — `help` + `hints` + `router`**
  Files: `src/commands/handlers/help-handler.ts`, `src/commands/command-hints.ts`, `src/commands/command-router.ts`, `src/commands/translate-acpx-note.ts`.
  Tests: matching tests.
  Commit: `feat(i18n): migrate help, hints, and router messages`

- [ ] **Task 14 — `render`**
  Files: `src/formatting/render-text.ts`.
  Tests: `tests/unit/formatting/*`.
  Commit: `feat(i18n): migrate render-text formatting strings`

- [ ] **Task 15 — `cli`**
  Files: `src/cli.ts` (including `HELP_LINES` → `t().cli.help` returning string[]), `src/cli-update.ts`.
  Tests: `tests/unit/cli*.test.ts` (assert help/usage via catalog).
  Commit: `feat(i18n): migrate CLI help and update output`

- [ ] **Task 16 — `channel` + `plugin` CLI**
  Files: `src/channels/cli/channel-cli.ts`, `src/plugins/plugin-cli.ts`, `src/plugins/validate-plugin.ts`, `src/plugins/compatibility.ts`.
  Tests: matching plugin/channel CLI tests.
  Commit: `feat(i18n): migrate channel and plugin CLI output`

- [ ] **Task 17 — `login` + `migrate`**
  Files: `src/weixin/auth/login-qr.ts`, `src/weixin/bot.ts` (user-facing), `src/weixin/messaging/slash-commands.ts`, `src/runtime/migrate-core-home.ts`.
  Tests: matching tests.
  Commit: `feat(i18n): migrate login, weixin bot, and migration messages`

- [ ] **Task 18 — `errors` (remaining sweep)**
  Files: any remaining `src/**` files still flagged by the guard once `MIGRATED_PREFIXES` is widened to `["src/"]` in a dry run — typically thrown `Error` strings and stray log text in `src/mcp/*`, `src/sessions/*`, `src/weixin/api/types.ts`, etc.
  Procedure: temporarily set `MIGRATED_PREFIXES = ["src/"]`, run the guard to list offenders, migrate each into the `errors` namespace (or the most fitting existing domain), re-run until empty.
  Commit: `feat(i18n): migrate remaining error/log strings`

---

## Task 19: Flip the guard repo-wide

**Files:**
- Modify: `tests/unit/i18n/no-hardcoded-cjk.test.ts`

- [ ] **Step 1: Replace the prefix list with the whole tree**

```ts
const MIGRATED_PREFIXES = ["src/"];
```

(The `src/i18n/messages/zh/` skip stays; `.test.ts`/`.spec.ts` are already excluded.)

- [ ] **Step 2: Run the guard + full suite**

Run: `npx tsc --noEmit && bun test`
Expected: PASS — no CJK string literals remain anywhere in `src/` except the `zh` catalog.

- [ ] **Step 3: Commit**

```bash
git add tests/unit/i18n/no-hardcoded-cjk.test.ts
git commit -m "test(i18n): enforce no-hardcoded-CJK across all of src/"
```

---

## Task 20: Document `config.language`

**Files:**
- Modify: `docs/config-reference.md` + `docs/zh/config-reference_zh.md`
- Modify: `docs/config-command.md` + `docs/zh/config-command_zh.md`
- Modify: `packages/docs/reference/configuration.md` + `packages/docs/zh/reference/configuration.md`
- Modify: `packages/docs/reference/commands.md` + zh (add `language` to `/config set` whitelist)
- Modify: `README.md` + `docs/zh/README_zh.md` (one line: language selection)

- [ ] **Step 1: Document the field and command**

Add `language` (`en` | `zh`, default = system locale on first run, restart to fully apply) to the config field reference, the `/config set` whitelist lists, and a short README note (`/config set language en`). Keep EN/ZH consistent (mirror the existing bilingual structure).

- [ ] **Step 2: Build the docs site to confirm**

Run: `bun run docs:build`
Expected: build completes (no dead links).

- [ ] **Step 3: Commit**

```bash
git add docs packages/docs README.md
git commit -m "docs(i18n): document config.language and /config set language"
```

---

## Task 21 (separate workstream): Channel plugin i18n

In-repo plugins are independently published; this is a follow-up plan, not part of the core sequence. Sketch:
- Thread the resolved `locale: Locale` through the existing channel-start/plugin context from core to the plugin.
- Give `packages/channel-yuanbao` and `packages/channel-feishu` their own small per-package catalogs (`src/i18n/{en,zh}.ts`) selected by the provided locale; migrate `packages/channel-yuanbao/src/command-sync.ts` and any Feishu user-facing strings.
- Add a per-package CJK guard mirroring Task 4.

Track this as its own spec/plan once core (Tasks 1–20) lands.

---

## Self-Review Notes

- **Spec coverage:** locale model (T1,T3), config field + system default + `/config set` (T2, T3, T20), per-domain typed catalogs (T1, T6–T18), compiler-enforced parity (typed `index.ts`, checked every task), regression guard scoped→repo-wide (T4, T6–T18 widening, T19), agent prompts (T11), tests assert via catalog (T6 step 6 + each task), channel plugins via own catalogs (T21), docs (T20). All spec sections map to tasks.
- **Migration honesty:** zh values are the current literals verbatim; en values are faithful translations; both enforced to stay in sync by the typed `Messages` contract and the CJK guard.
