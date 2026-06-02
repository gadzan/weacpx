# Native Agent Sessions

## Overview

`/ssn` (short for "session native") lets you attach xacpx to an agent session that is already running on the local machine — for example, a Codex session you started from the terminal — without disrupting its existing context or conversation history.

After attaching, you continue the same native session from your phone or any chat channel. Messages you send go directly into that session; the agent's replies stream back to the chat.

## Session concepts

xacpx maintains two distinct session layers:

| Layer | Managed by | What it tracks |
|---|---|---|
| **Logical session** | xacpx (`SessionService`) | Alias, agent binding, workspace binding, chat context, and which transport session it points to |
| **Native (transport) session** | `acpx` / the agent itself | The actual running agent process and its conversation state |

Most commands — `/ss`, `/use`, `/session rm` — operate on the logical session layer. `/ssn` is the bridge that connects xacpx logical sessions to existing native sessions rather than creating new ones.

**Key rule:** `/session rm <alias>` deletes the xacpx logical mapping only. It does not terminate or delete the underlying native agent session.

## Use `/ssn`

### When to use `/ss` vs `/ssn`

| Goal | Command |
|---|---|
| Start a new remote session from scratch | `/ss <agent> -d /path/to/repo` |
| Switch back to an existing xacpx session | `/use <alias>` |
| Attach to a native agent session already running locally | `/ssn <agent> --ws <workspace>` |
| List native sessions under the current agent/workspace | `/ssn` |
| Attach by known native session ID | `/ssn attach <sessionId> -a <alias>` |

`/ss` does not enumerate or attach to existing native sessions — it only manages the xacpx logical session layer. After attaching via `/ssn`, a new logical session alias is created (e.g. `codex-e8e552e7`) and appears in `/ss` lists. Use `/use <alias>` to switch back to it later.

### List native sessions for the current context

```text
/ssn
```

Uses the current xacpx session's agent and workspace context to query for native sessions.

### Attach by workspace name

```text
/ssn codex --ws project
```

If exactly one candidate is found, xacpx attaches immediately and switches to it. The default alias format is:

```text
<agent>-<last-8-chars-of-sessionId>
```

For example: `codex-e8e552e7`. If that alias or the underlying transport session name is already in use, xacpx appends a suffix automatically (`-2`, `-3`, etc.) to avoid overwriting an existing session.

### Select from a list

When there are multiple candidates, xacpx displays a numbered list and waits:

```text
/ssn codex --ws project
/ssn 1
```

`/ssn 1`, `/ssn 2`, etc. select from the most recent list. The list expires after a short time; re-run the `/ssn` command if it has expired.

To set a custom alias when selecting:

```text
/ssn 1 -a fix-ci
```

On WeChat, where full session IDs are not visible in the list, selecting by number and assigning an alias is more practical than using `/ssn attach <sessionId> -a ...`.

### Attach by absolute path

```text
/ssn codex -d /Users/me/project
```

Use this when the workspace is not registered in xacpx. xacpx resolves or creates an internal workspace context bound to the given path.

### Attach by session ID

```text
/ssn attach 019e5d48 -a fix-ci
```

This uses the context from the most recent `/ssn` query. If no context exists yet, run a workspace query first:

```text
/ssn codex --ws project
```

The long-form equivalent:

```text
/ss attach native 019e5d48 -a fix-ci
```

### Cross-workspace query

By default `/ssn` filters by the current working directory. To search across all workspaces for a given agent:

```text
/ssn codex --ws project --all
```

If the backend returns paginated results, the list footer shows a continuation command you can send directly.

## Attach and switch behavior

After a successful attach:

- Subsequent plain messages are forwarded to the same native agent session.
- `/use <alias>`, `/ss` (list), and `/status` all work on the xacpx logical session as usual.
- If the same native session ID is selected again by `/ssn`, xacpx switches back to the already-attached logical session rather than creating a duplicate.

### Command reference

| Command | Description |
|---|---|
| `/ssn` | Query native sessions using the current xacpx session context |
| `/ssn codex --ws project` | Query Codex native sessions under a named workspace |
| `/ssn codex -d /Users/me/project` | Query by absolute local path |
| `/ssn codex --ws project --all` | Cross-workspace query for this agent |
| `/ssn 1` | Attach or switch to candidate 1 from the most recent list |
| `/ssn 1 -a <alias>` | Attach candidate 1 with a custom alias |
| `/ssn attach <sessionId> -a <alias>` | Attach a specific session ID with a custom alias |
| `/ss attach native <sessionId> -a <alias>` | Long form of `/ssn attach` |
| `/help ssn` | Show the condensed help message in chat |

## Limitations

- The local `acpx` version must support agent-side session query and resume. If it does not, xacpx prompts you to use `/ss` instead.
- The agent itself must support native session listing and resume. Not all agents implement this.
- When using `--ws <name>`, the workspace must already be registered in xacpx, or use `-d <absolute-path>` to reference the directory directly.
- `/ssn` only queries sessions on the **local machine** where the xacpx daemon is running. It does not query remote hosts.
- The numbered candidate list is short-lived. If it expires, re-run the `/ssn` query.

## Troubleshooting

**"Current transport does not support listing native sessions"**

The installed `acpx` version or the agent in use does not implement session enumeration. You can still manage normal xacpx sessions with `/ss <agent> -d /path/to/repo`.

**`/ssn codex` shows a list instead of auto-attaching**

Specifying only the agent name is ambiguous. Add a workspace or path to enable automatic single-candidate attachment:

```text
/ssn codex --ws project
/ssn codex -d /Users/me/project
```

**Attach failed — will it overwrite my existing sessions?**

No. xacpx checks both the alias and the underlying transport session name before attaching. On conflict, it auto-assigns a suffixed alias (e.g. `codex-e8e552e7-2`).

**Will my phone conversation appear in the local agent terminal?**

Yes. `/ssn` resumes the same native agent session — it does not create a copy. Whether the full conversation history appears in the local CLI depends on the agent's own session display capability.
