# xacpx Runtime Internationalization (i18n) — Design

**Date:** 2026-06-02
**Status:** Approved (design), pending implementation plan
**Topic:** Make all runtime user-facing strings translatable; one global locale (`en` | `zh`) selected by config, defaulting to the system locale on first run.

## Problem

xacpx's runtime output is hard-coded in Chinese — roughly **506 inline Chinese string literals across ~76 source files**. There is **no existing i18n/locale infrastructure** and no `language` config field. This blocks non-Chinese users and makes the product inconsistent with the now-English-primary README/docs.

The Chinese strings span every user-facing surface:

- **Chat command responses** — `src/commands/handlers/*` (session, native-session, later, orchestration, config, permission, workspace, agent, help, recovery), `src/formatting/render-text.ts`, `src/scheduled/scheduled-render.ts`, `src/commands/command-hints.ts`, `src/commands/command-router.ts`.
- **CLI terminal output** — `src/cli.ts` (incl. `HELP_LINES`), `src/channels/cli/channel-cli.ts`, `src/plugins/plugin-cli.ts`, `src/cli-update.ts`, `src/weixin/auth/login-qr.ts`.
- **Agent-facing orchestration prompts** — `src/orchestration/build-coordinator-prompt.ts`, `src/orchestration/worker-prompts.ts`, `src/orchestration/render-delegate-group-result.ts`.
- **Error / log messages** — thrown `Error` text and log lines, some of which surface back to users.

## Goals

1. A single global locale (`en` | `zh`) selects the language for **all** runtime output.
2. Default is **system-locale-derived** on first run, then persisted and user-overridable.
3. Adding a third locale later is a matter of adding one set of files, not touching call sites.
4. The compiler guarantees locale catalogs stay in sync (no missing/renamed keys).
5. A regression guard prevents new hard-coded Chinese from creeping back in.

## Non-Goals

- **Per-user / per-channel dynamic locale.** Out of scope. One global locale per deployment. (Revisitable later; see "Future".)
- **ICU message-format / gettext tooling.** Not needed for a set-once-at-startup model.
- **Translating the documentation site / repo docs.** Already handled separately.
- **Code comments.** Chinese comments are not user-facing; the regression guard targets string literals only.

## Decisions (locked during brainstorming)

| Decision | Choice |
|---|---|
| Locale selection model | **Global default, config-driven** (`config.language`) — no per-request threading |
| Default when unset | **Follow system locale** (`$LC_ALL`/`$LC_MESSAGES`/`$LANG`: `zh*` → `zh`, else `en`), persisted on first run |
| Scope | Chat responses + CLI output + agent prompts + error/log messages |
| Mechanism | **Typed homegrown catalog, no dependency** |
| File layout | **Per-domain files** under `src/i18n/messages/<locale>/<domain>.ts` |
| Channel plugins | Own their own per-package catalogs; receive locale via plugin context (not folded into core) |
| Regression guard | Fails on CJK in **string literals** only (comments exempt) |

## Architecture

### 1. Locale resolution & bootstrap

A pure resolver, dependency-free and side-effect-free:

```ts
// src/i18n/resolve-locale.ts
export type Locale = "en" | "zh";
export function resolveLocale(input: {
  configLanguage?: string;          // config.language if present
  env?: NodeJS.ProcessEnv;          // defaults to process.env
}): Locale;
```

Resolution order:
1. `configLanguage` if it is a valid `Locale`.
2. Else inspect `env.LC_ALL` → `env.LC_MESSAGES` → `env.LANG`; if the value matches `^zh` (case-insensitive) → `zh`, otherwise `en`.

Each **process entrypoint** resolves once and calls `setLocale(...)` before producing any output:

- **Daemon** (`src/main.ts` `buildApp` / `src/run-console.ts`): resolve from the loaded config, set locale during runtime assembly.
- **CLI** (`src/cli.ts`): resolve as early as possible — read config if it exists (via `resolveRuntimePaths`/`ConfigStore`), else fall back to system locale — so even pre-config commands (`xacpx login`, first-run) print correctly.
- **Bridge subprocess** (`src/bridge/bridge-main.ts`) and **`mcp-stdio`**: the parent passes the resolved locale through an env var **`XACPX_LANG`**; the subprocess reads it (falling back to `resolveLocale` if absent). This avoids re-reading config in children and keeps parent/child language identical.

**First-run persistence:** the existing first-run setup flow (which offers to create a workspace + pick an agent) also writes the resolved `language` into `config.json` so the choice is stable and visible. If `config.language` is already set, it is respected and never overwritten.

### 2. Config field

Add an optional top-level field to the config schema (`src/config/config-store.ts`):

```jsonc
{
  "language": "en" | "zh"   // optional; absent = derive from system on first run
}
```

- Validated on load; an invalid value falls back to system resolution (and is not written back over an explicit user value).
- Exposed to the `/config set` whitelist as `language` so users can switch from chat (`/config set language en`), consistent with the existing config-command surface. Changing it requires a daemon restart to fully take effect (documented).

### 3. The i18n module

```
src/i18n/
  index.ts                 # runtime: setLocale/getLocale/resolveLocale re-export/t()
  resolve-locale.ts        # pure resolver (above)
  types.ts                 # the Messages interface (the contract)
  messages/
    en/
      index.ts             # aggregates domains → `const en: Messages = {...}`
      session.ts
      native-session.ts
      later.ts
      orchestration.ts     # includes agent-facing prompt templates
      config.ts
      permission.ts
      workspace.ts
      agent.ts
      help.ts
      render.ts
      cli.ts
      plugin.ts
      channel.ts
      update.ts
      login.ts
      recovery.ts
      errors.ts
      hints.ts
    zh/
      index.ts             # `const zh: Messages = {...}`
      …same domain files…
```

**`types.ts`** declares one `Messages` interface, namespaced by domain. Each leaf is either a `string` (static) or a typed **function** (parameterized):

```ts
export interface SessionMessages {
  noCurrent: string;
  created: (alias: string) => string;
  switched: (alias: string) => string;
  // …
}
export interface Messages {
  session: SessionMessages;
  later: LaterMessages;
  orchestration: OrchestrationMessages;
  // …all domains
}
```

Each locale's `index.ts` is typed as `Messages` (`const en: Messages = { session, later, … }`). Because **both** `en` and `zh` are declared `Messages`, TypeScript fails the build if either is missing a key, has an extra key, or has a mismatched function signature. This is the locale-parity guarantee — no runtime catalog-walk needed.

**`index.ts` runtime:**

```ts
let active: Messages = en;                 // safe default before setLocale
export function setLocale(locale: Locale): void { active = locale === "zh" ? zh : en; }
export function getLocale(): Locale { return active === zh ? "zh" : "en"; }
export function t(): Messages { return active; }
```

Call sites use `t()` **at call time**:

```ts
// before
return { text: "当前还没有选中的会话。请先执行 /session new ... 或 /use <alias>。" };
// after
return { text: t().session.noCurrent };
// parameterized
return { text: t().session.created(alias) };
```

### 4. Migration rule

**Never bind a catalog string at module top-level.** Today's pattern —
`const NO_CURRENT_SESSION_TEXT = "当前…"` evaluated at import time — would capture the default locale before `setLocale` runs. Migration replaces every such constant with a `t()` call inside the function body. Help/usage metadata objects that are currently module-level constants become functions or getters that read `t()` lazily.

### 5. Regression guard

A unit test (e.g. `tests/unit/i18n/no-hardcoded-cjk.test.ts`) scans `src/**/*.ts` and fails if any **string literal** (single/double/backtick) contains a CJK character, with an allowlist:

- Exempt: `src/i18n/messages/zh/**` (the Chinese catalog — the one place Chinese lives).
- Exempt: `*.test.ts` / `*.spec.ts`.
- Exempt: code comments (the scan inspects string-literal tokens, not comments).

During migration the guard is **scoped to already-migrated directories** (an allowlist of completed paths) and flipped to **repo-wide** once every domain is done.

### 6. Agent prompts

Coordinator/worker prompt builders move their templates into `orchestration` domain functions (e.g. `coordinatorSystemPrompt(args)`, `workerTaskPrompt(args)`). Selecting `en` therefore makes xacpx instruct agents in English, so agent replies come back in the user's language. These are large multi-line templates but are ordinary function-valued catalog entries.

### 7. Channel plugins (`packages/channel-*`)

In-repo plugins (`channel-yuanbao`, `channel-feishu`) are independently published packages and must not import core's internal `src/i18n`. Instead:

- The plugin/channel-start context (already passed from core to channels) carries the resolved `locale: Locale`.
- Each plugin keeps a **small own catalog** for its handful of user-facing strings, selecting by the provided locale.
- This keeps the package boundary clean and lets plugins ship/version independently. The core `Messages` contract is core-only.

(Plugin migration is a distinct, smaller workstream sequenced after core.)

### 8. Testing strategy

- **i18n unit tests:** `resolveLocale` (env precedence + `zh*` detection + invalid-config fallback), `setLocale`/`getLocale`/`t()` switching.
- **Parity:** enforced by the TypeScript compiler (`satisfies`/typed `const`); optionally a tiny test asserting `Object.keys` parity at the top namespace level as a smoke check.
- **Existing assertion tests:** many unit tests currently assert Chinese response text. They are updated to (a) set a known test locale in setup and (b) assert against the **catalog** (`t().session.created(alias)`) rather than re-typed literals — keeping tests locale-agnostic and DRY, and avoiding a brittle hand re-translation of every assertion.

## Phased rollout

The spec defines the architecture; the implementation plan sequences the migration into shippable phases:

1. **Foundation** — `src/i18n/` module (`types.ts`, `index.ts`, `resolve-locale.ts`), `config.language` field + `/config set` whitelist entry, locale bootstrap at all entrypoints (daemon, CLI, bridge, mcp-stdio), and the regression guard scoped to `src/i18n/**`.
2. **Domain migrations** (each keeps the full test suite green, expands the guard allowlist):
   - session + native-session + recovery + workspace + agent
   - later + scheduled-render
   - orchestration (handlers + agent prompts + delegate-group rendering)
   - config + permission + help + hints + command-router + render-text
   - cli + channel-cli + plugin-cli + cli-update + login-qr
   - errors/log messages sweep
3. **Flip the guard repo-wide**; remove the directory allowlist.
4. **Channel plugins** — thread locale through plugin context; give `channel-yuanbao` / `channel-feishu` their own catalogs.
5. **Docs** — document `config.language`, the `/config set language` command, and the system-locale default in README + `docs/` + the docs site.

## Risks & mitigations

- **Scale (506 strings / 76 files).** Mitigated by per-domain phasing with green tests at each step, and the compiler-enforced parity catching omissions.
- **Top-level string capture before `setLocale`.** Mitigated by the migration rule + `active` defaulting to a valid catalog (`en`) so a missed bootstrap degrades to English rather than crashing.
- **Tests asserting Chinese.** Mitigated by pointing assertions at the catalog instead of literals.
- **Subprocess locale drift.** Mitigated by `XACPX_LANG` env propagation with a `resolveLocale` fallback.
- **Agent-prompt wording regressions** changing agent behavior. Mitigated by treating prompt templates as exact ports first (en = faithful translation of current zh), behavior-preserving, before any wording improvements.

## Future (explicitly out of scope now)

- Per-user / per-channel locale (would reuse the same catalog; requires threading a locale through the message context instead of a global).
- Additional locales (add `messages/<locale>/` — no call-site changes).
- Externalizing catalogs to a translation-management format if community translations are wanted.
