# Agent-side Native Session UX Design

## Context

acpx 0.9.0 can list and resume agent-side sessions through ACP (`session/list` and `session/resume`). For Codex, the ACP adapter maps these calls to Codex app-server threads: `session/list` lists Codex threads, `session/resume` resumes a thread by ID, and subsequent prompts run turns on that same Codex thread. Therefore, when weacpx attaches to a Codex native session through acpx, later turns continue the original Codex session rather than copying its context into an isolated acpx-only conversation.

The goal is to let users continue local Codex work from weacpx with minimal new concepts. Existing `/ss` behavior must remain predictable: if a weacpx logical session already exists for an agent/workspace, `/ss codex --ws project` or `/ss codex -d /Users/me/project` should reuse that existing logical session, not silently switch to a native session.

## Goals

- Keep the existing `/ss` mental model intact for normal weacpx logical sessions.
- Add a concise native-session entrypoint for users who explicitly want to query, attach, or switch to local agent-side sessions.
- Make day-to-day native switching require remembering only `/ssn` and `/ssn <number>`.
- Avoid duplicate logical sessions for the same native session once it has been attached.
- Support both `acpx-cli` and the default `acpx-bridge` transport.
- Degrade clearly when the active agent does not support ACP `session/list` or `session/resume`.

## Non-goals

- Do not automatically attach native sessions from ordinary prompt messages.
- Do not change existing `/ss codex ...` reuse semantics.
- Do not copy/import full historical Codex turns into weacpx state or acpx local history.
- Do not require users to learn ACP terminology.

## User-facing Command Model

### Existing weacpx sessions

`/ss <agent> (-d <path> | --ws <workspace>)` keeps its current behavior:

1. Resolve or create the workspace.
2. If a visible logical session already exists for that agent/workspace, switch to it.
3. Otherwise create a new weacpx/acpx session using the existing shortcut flow.

Example:

```text
/ss codex --ws project
```

If `project:codex` already exists, the response remains a reuse response:

```text
已切换到会话「project:codex」
- 复用工作区：project
- 复用会话：project:codex
```

### Native session shortcut

Add `/ssn` as a first-class alias for `/ss native`.

Users should be able to use either form:

```text
/ssn
/ss native
```

But documentation and help should prefer `/ssn` as the simple command.

### Query native sessions

`/ssn` with no extra arguments queries native sessions for the current context:

- If there is a current logical session, use its agent and workspace cwd.
- If there is no current session, ask the user to specify an agent and workspace/path.
- This command lists candidates only; it should not auto-attach, because users may be inspecting after a few turns in an existing session.

Example response:

```text
本地 Codex 会话（project）：
1. 修复 CI 失败
   12 分钟前 · 019e5d48... · 已接入：fix-ci [当前]
2. 调研 native session
   40 分钟前 · 019e5e96...

切换：/ssn 2
指定别名接入：/ssn attach <sessionId> -a fix-ci
更多：/ssn --all
```

`/ssn <agent> --ws <workspace>` and `/ssn <agent> -d <path>` query native sessions for an explicit target. When this explicit target has exactly one candidate, it should auto-attach because the user has explicitly asked for native session access for that target.

Examples:

```text
/ssn codex --ws project
/ssn codex -d /Users/me/project
```

Behavior:

- 0 candidates: explain that no local Codex native sessions were found for the target.
- 1 candidate: attach it, or switch to the existing attached logical session if already attached.
- Multiple candidates: show a numbered list and cache the list for follow-up selection.

### Attach or switch by selection

Support short selection commands:

```text
/ssn 1
/ssn attach 1
/ss attach native 1
```

All three mean “attach/switch to item 1 from the latest native-session list for this chat”. If the native session is already attached to a logical weacpx session visible in the current channel, switch to that logical session instead of creating a duplicate.

Support direct session IDs:

```text
/ssn attach <sessionId>
/ssn attach <sessionId> -a fix-ci
/ss attach native <sessionId> -a fix-ci
```

`-a` is an alias for the weacpx logical session alias in native attach commands. `--alias` should also be accepted for clarity. This is intentionally different from existing `/session attach ... -a <agent>`; parsing should keep these command families distinct.

## State and Deduplication

Extend logical session metadata with optional native-source fields:

```ts
source?: "weacpx" | "agent-side";
agent_session_id?: string;
agent_session_title?: string;
agent_session_updated_at?: string;
attached_at?: string;
```

These fields are optional for backward compatibility. Existing sessions without `source` are treated as `weacpx`.

When attaching a native session, search visible logical sessions for the same agent command / workspace and `agent_session_id`. If found, switch to the existing session rather than creating a new one.

The native list renderer should annotate already-attached candidates:

```text
已接入：fix-ci
已接入：fix-ci [当前]
```

## Alias and Transport Session Naming

Default logical alias remains consistent with the current shortcut style:

```text
<workspace>:<agent>
```

If that alias already exists and points to a different native session, allocate a suffix:

```text
project:codex-2
project:codex-3
```

If the user supplies `-a/--alias`, use that alias after channel scoping and normal collision checks.

The acpx transport session should be unique and must not close or replace an unrelated existing acpx record. Native attach should use acpx resume semantics, not plain ensure:

```bash
acpx <agent> sessions new --name <transportSession> --resume-session <agentSessionId>
```

Using `sessions ensure --resume-session` is unsafe for explicit attach because `ensure` can reuse an existing named record and ignore the requested native session.

## Transport Design

Add transport-level capabilities that keep weacpx logical-session concerns outside the transport implementation:

```ts
interface AgentSession {
  sessionId: string;
  cwd?: string;
  title?: string | null;
  updatedAt?: string;
  _meta?: Record<string, unknown>;
}

interface AgentSessionListResult {
  source: "agent";
  sessions: AgentSession[];
  cursor?: string;
  nextCursor?: string | null;
  cwd?: string;
}

interface SessionTransport {
  listAgentSessions?(session: ResolvedSession | AgentSessionQuery): Promise<AgentSessionListResult | undefined>;
  resumeAgentSession?(session: ResolvedSession, agentSessionId: string): Promise<void>;
}
```

The exact TypeScript shape can be refined during implementation, but responsibilities should stay clear:

- transport lists agent-side sessions through acpx `sessions list --format json`;
- transport creates/resumes the acpx local record through `sessions new --resume-session`;
- command/session handlers decide aliases, workspace creation, channel scoping, deduplication, and current-session switching.

Both `acpx-cli` and `acpx-bridge` need support. The bridge protocol should add methods for list/resume rather than shelling out through the CLI transport from the parent process.

## Native List Cache

Store the latest native list per chat context so `/ssn 1` is stable:

```ts
native_session_lists?: Record<string, {
  created_at: string;
  agent: string;
  workspace?: string;
  cwd?: string;
  sessions: AgentSession[];
  next_cursor?: string | null;
}>;
```

The cache should be short-lived, e.g. 10 minutes. If expired or missing, `/ssn 1` should ask the user to run `/ssn` again rather than re-listing and risking a changed order.

## Error Handling and Degradation

- If `session/list` is unsupported, respond that this agent cannot list native sessions and suggest normal `/ss` usage.
- If `session/resume` is unsupported but `session/load` exists, acpx may load the session; for Codex 0.130-era adapters, resume is supported. The UX should still present this as “接入本地会话”.
- If resume fails, do not create a fresh unrelated session silently. Tell the user the native session could not be resumed.
- If no current context exists for `/ssn`, ask for one of:

```text
/ssn codex --ws project
/ssn codex -d /Users/me/project
```

## Help Text

Session help should include a small native section:

```text
本地 native 会话：
/ssn                         查看当前上下文的本地 Codex 会话
/ssn 1                       接入/切换到列表第 1 个
/ssn codex --ws project      查询 project 的本地 Codex 会话
/ssn attach <sessionId> -a fix-ci  指定别名接入
```

The docs should describe the mental model as:

```text
/ss  管 weacpx 会话
/ssn 管本地 native 会话
```

## Testing Strategy

Unit tests should cover:

- command parsing for `/ssn`, `/ssn 1`, `/ssn attach 1`, `/ss native ...`, and `/ss attach native ...`;
- `/ss codex --ws project` reuses existing logical sessions and does not list native sessions;
- `/ssn` with current context lists native sessions and caches the numbered results;
- `/ssn <agent> --ws <workspace>` auto-attaches only when exactly one candidate exists;
- `/ssn 1` uses the cached list and switches to an existing attached logical session when possible;
- native attach creates a logical session with native-source metadata;
- transport command construction uses `sessions new --resume-session`, not plain `ensure`;
- `acpx-bridge` exposes equivalent list/resume behavior;
- unsupported capability and resume failure produce explicit user-facing errors.

## Open Implementation Notes

- Existing state stores tolerate additional optional fields if parsing is permissive; confirm before editing state types.
- Existing `/session attach` uses `-a` for agent. Native attach uses `-a` for alias only in `/ssn attach` and `/ss attach native`; command parsing must avoid ambiguity.
- Current shortcut aliases are workspace-first (`project:codex`). Keep that unless the project intentionally changes alias conventions separately.
