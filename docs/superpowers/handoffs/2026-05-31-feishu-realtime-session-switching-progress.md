# Feishu Realtime Session Switching — Progress (handover)

**Updated:** 2026-06-01
**Branch:** `feat/feishu-realtime-session-switching` — local only, NOT pushed.
**Spec:** `docs/superpowers/specs/2026-05-31-feishu-realtime-session-switching-design.md`
**Plan:** `docs/superpowers/plans/2026-05-31-feishu-realtime-session-switching.md`

## ✅ RESOLVED (2026-06-01, later) — branch is GREEN end-to-end
The test-execution blocker is fixed. Root cause was NOT exports ordering / root tsconfig (those experiments were reverted; root tsconfig has no `paths`). It was `packages/channel-feishu/tsconfig.json` `paths: {"weacpx/plugin-api": ["dist/plugin-api.d.ts"]}` — **bun honors tsconfig `paths` at test runtime** (resolved against the nearest tsconfig to the imported file), so any test pulling in a `packages/channel-feishu/src/*` file loaded the un-executable `.d.ts`. Fix (commit `8b0f78a`): extensionless `["dist/plugin-api"]` — bun picks `.js`, tsc picks `.d.ts`. Also corrected the new test fixtures to the canonical flat `{ appId, appSecret }` config + stub account `dmPolicy:"open"`. Then `docs/commands.md` got the Feishu B-semantics note (`cdee2d6`). **`node ./scripts/run-tests.mjs tests/unit` → rc 0; full feishu dir 272 pass / 0 fail; root tsc + package tsc + `bun run build:channel-feishu` all clean.** Task 9 done. Everything below this banner is the earlier (now-superseded) "blocked" accounting.

## TRUE STATE (verified by clean git + python-subprocess gates, 2026-06-01)
HEAD = `2b4e49c`. Implementation Tasks 1–8 are committed; **`bun run build`, root `npx tsc --noEmit`, and `npx tsc -p packages/channel-feishu/tsconfig.json --noEmit` are ALL green.** tsconfig.json is pristine (an earlier corrupting commit `63ae687` was reset out of history).

**Honest caveat on feishu test EXECUTION:** the feishu unit-test harness cannot run locally because of a PRE-EXISTING repo infra issue (bun resolves `weacpx/plugin-api` → declaration-only `dist/plugin-api.d.ts` → `Cannot find module './plugins/types.js'`). It hits pre-existing unmodified feishu tests too. I tried several tsconfig/exports variants to fix it; none satisfy BOTH bun (needs runtime `.js`) AND tsc (needs `.d.ts`) via a single `paths` entry, and each broke either the package build (`TS6059`) or tsc. I reverted ALL such experiments — repo is pristine. So: **the new feishu tests are written and the feature code builds + typechecks clean, but the new feishu tests have NOT been observed passing at runtime.** When I briefly DID get them to run (via a since-reverted package-tsconfig hack), 15 passed and 4 failed — the 4 failures were a TEST-ONLY bug (wrong `FeishuChannel` config shape: must be `{ enabled: true, accounts: [{ appId, appSecret, enabled:false }] }`, NOT the flat `{ appId, appSecret, enabled }`). That config-shape fix is committed in `2b4e49c`, but could not be re-verified after reverting the resolution hack. The remaining open work is: (a) decide how feishu tests are meant to run in this repo (no CI test workflow exists — only publish), (b) re-run + confirm the new feishu tests green, (c) Task 9 docs + final review.

| Task | What | State |
|---|---|---|
| 1 | move conversation-executor → `src/runtime/` (`7206b18`) | DONE, reviewed ✅✅ |
| 2 | `resolveTurnLane` (`165ad1d`,`92eb6bf`) | DONE, reviewed ✅✅ |
| 3 | export via `src/plugin-api.ts` (`2b623ae`) | DONE, reviewed ✅✅ |
| 4 | feishu `start()` captures sessions/activeTurns + executor (`9a69393`) | DONE, reviewed ✅✅ |
| 5 | `boundAlias` on ActiveTask (`0109f91`) | DONE |
| 6 | per-session lanes + control preemption + dispatch binding (`e807064`) | DONE (had a silent markInactive gap; fixed in `e199302`) |
| 7 | bg completion signal + ping in runTurn finally (`ee1afef`) | DONE (logic silently failed to apply in ee1afef; **actually applied in `e199302`**) |
| 8 | `/cancel <alias>` control-lane dispatch tests (`d51c89f`) | DONE — core `handleCancel(alias)` already resolves+cancels the session (verified); feishu routes /cancel,/stop to control lane |
| 9 | docs update for feishu B-semantics + final adversarial review | **NOT DONE** |

`e199302` ("fix(feishu): complete background completion signal + markInactive") is the corrective commit: earlier commits `e807064`/`ee1afef` had silently-failed string edits (RTK garbling) so channel.ts had `markActive` with no `markInactive` and was MISSING the entire completion-signal block, while committing tests + completion-notice.ts that referenced a not-yet-existing method. `e199302` applied the real logic via an atomic exact-match patcher.

## VERIFIED GATES (all via python subprocess to bypass RTK shell garbling)
- `bun run build` → rc 0 (clean).
- `npx tsc --noEmit` (root) → clean.
- `npx tsc -p packages/channel-feishu/tsconfig.json --noEmit` (THE gate that covers channel.ts) → clean.
- channel.ts consistency: markActive=1, markInactive=1 (balanced), executor.run=1, enqueueFeishuChatTask=0, setBackgroundResult present, sendBackgroundCompletionNotice def+call=2, boundSessionAlias merged into agent.chat metadata.

## ⚠️ NOT VERIFIED: feishu test EXECUTION is BLOCKED (pre-existing infra issue)
**I could NOT get any feishu test to run locally** — not my new ones, not pre-existing ones. `node ./scripts/run-tests.mjs tests/unit/packages/channel-feishu` aborts at the FIRST feishu file (`feishu-abort-channel.test.ts`, which is PRE-EXISTING and unmodified) with:
`error: Cannot find module './plugins/types.js' from .../dist/plugin-api.d.ts`.
- `bun install` does NOT create a `node_modules/weacpx` symlink (verified ENOENT after install) — the earlier "workspace symlink" theory was WRONG.
- Root cause (see memory `reference_feishu_tests_need_fresh_dist`): bun resolves the bare `weacpx/plugin-api` import via root `package.json` `exports["./plugin-api"]`, which lists `"types"` before `"default"`, so bun loads the declaration file `dist/plugin-api.d.ts` and tries to execute it → fails on its `./plugins/types.js` re-export (no per-module `.js` in the bundle).
- This affects PRE-EXISTING feishu tests identically, so it is NOT introduced by this feature. But it means **the new feishu unit tests (concurrency, completion-awareness, completion-notice, cancel-alias, start-wiring) have been written and typecheck, but have NEVER been executed/observed green.** This is the single biggest open risk on the branch.
- Likely fix (NOT applied — repo infra, flag first): add a root `tsconfig.json` `paths` alias `"weacpx/plugin-api": ["./src/plugin-api.ts"]` so bun resolves to runnable source; OR reorder the `exports` conditions (`default`/`import`/`bun` before `types`). MUST confirm the whole `tests/unit` stays green + CI/typecheck unaffected. OPEN QUESTION: how does this repo's owner normally run feishu tests green? (No CI test workflow exists — only publish workflows.) Ask before changing infra.

## SEVERE SESSION HAZARDS encountered (for whoever continues)
- RTK shell hook garbled `cat`/`grep`/`echo`/`python3 -c` stdout and the Read tool, AND fabricated git SHAs + commit messages in subagent reports (claimed commits `1cf0e7f`/`34a4e329`/`98f3f7c` never existed). ALWAYS verify SHAs with `git cat-file -t`. Read via `python3` writing a file, then Read the file; or base64 round-trip.
- carpool 5h quota exhaustion repeatedly killed subagents mid-work (0-token returns) → some "committed" work was never actually written. Verify artifacts on disk, never trust a subagent's "DONE".
- Subagent dispatch became unreliable; remaining tasks were implemented INLINE with atomic python patchers (exact-string match, abort-on-miss) instead.

## What remains (Task 9)
1. `docs/commands.md`: the realtime-switching section (~line 122) describes WEIXIN semantics ("/use 查看结果" replay). Add a note that feishu uses **B-semantics**: the backgrounded session's card streams to completion in the timeline, switch-back does NOT replay, completion ping is just `✅ <alias> 已完成` (no "/use 查看结果"), `/sessions` shows ●.
2. A clean final adversarial review of the whole branch (`9a69393^..e199302` feishu portion) was NOT done cleanly — recommend one before merge.
3. Then superpowers:finishing-a-development-branch. Branch is local; prior pattern: user merges to main locally then says "push it".

## Validate what IS verifiable
```
bun run build                                                # clean
npx tsc --noEmit                                             # clean
npx tsc -p packages/channel-feishu/tsconfig.json --noEmit   # clean (covers channel.ts)
```
Feishu test execution is blocked (see "NOT VERIFIED" section) — resolve the `weacpx/plugin-api` → dist resolution first, then `node ./scripts/run-tests.mjs tests/unit/packages/channel-feishu`.
