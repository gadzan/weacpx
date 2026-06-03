# `/later` Scheduled Task Command Reference

`/later` (alias `/lt`) lets you schedule a **one-off** scheduled task in chat: execute a plain message at some future time—by default in a **temporary session** newly created for that task (it inherits the agent and workspace of the current session at creation time, has a fresh conversation history, and is destroyed once it finishes), or you can use `--bind` to send it to the current session bound at creation time; in both modes the agent's reply is pushed back to the original chat.

> The README only provides basic guidance; this document is the complete reference. For a command-surface quick reference, see [commands.md](./commands.md); for the interaction design and trade-offs, see [superpowers/specs/2026-05-23-later-scheduled-tasks-design.md](./superpowers/specs/2026-05-23-later-scheduled-tasks-design.md).

## Mental Model

> Execute a plain user message at some time within the next 7 days: by default in a **temporary session** (inheriting the agent and workspace at creation time), or with `--bind`, send it to the current session bound at creation time.

- A current session is **required** when creating the task: temporary mode uses it to **snapshot the agent and workspace**, and bind mode (`--bind`) uses it to determine the delivery target. Both modes are fixed at the moment of creation; later switching to a different session with `/use` **does not affect** an already-created task.
- The current chat channel must support **scheduled message delivery**. If the channel plugin does not implement `sendScheduledMessage`, `/lt <time> <message>` is rejected at creation time and will not save a task that is bound to fail when it comes due.
  - The built-in WeChat channel, the Feishu plugin channel, and the Yuanbao plugin channel support this capability; third-party channels must implement `sendScheduledMessage` before they are allowed to create `/lt` tasks.
- It sends only **plain messages**; it will not delay-execute xacpx's `/` commands.
- One-off: it runs once when due, with no repetition.

## Execution Session: Temporary Session (default) vs Bound Current Session

When a scheduled task comes due, there are two execution-session modes:

- **Temporary session (default)**: a clean session is created to run this task, inheriting the agent and workspace of the current session at creation time, but with a brand-new conversation history; once the task finishes, that session is destroyed. This better matches the expectation that "a scheduled task should not pollute the session I'm using."
- **Bound current session (`--bind`)**: the message is sent to the session bound at creation time, and the result enters that session's context (the old behavior).

```text
/lt in 2h Check CI            # temporary session (default)
/lt --bind in 2h Check CI     # bind the current session
/lt --temp tomorrow 09:00 Look at the PR   # explicitly temporary (use when the default has been changed to bind)
```

- `--bind` and `--temp` are mutually exclusive; supplying both is rejected.
- The default mode can be changed via the config `later.defaultMode` (`"temp"` | `"bind"`, default `"temp"`); see [config-reference.md](./config-reference.md).
- Both modes require a current session at creation time (temporary mode needs it to snapshot the agent/workspace).
- A temporary session cannot be continued: a reply to the result message enters your current normal session and will not revive the temporary session.

## Command Overview

```text
/later                  # show help
/later <time> <message> # create a one-off scheduled task
/later list             # view global pending tasks
/later cancel <id>      # cancel a pending task
```

`/lt` and `/later` are fully equivalent:

```text
/lt
/lt in 30m Check CI
/lt list
/lt cancel k8f2
```

## Natural-Language Creation and Management (within the current session)

In addition to the `/lt` command, an agent in ordinary conversation can also create the same scheduled task—through an MCP tool internal to the current session—when it understands "remind me to do something later / tomorrow / at some time." This capability is only exposed to the queue owner that xacpx starts for the **current conversation session**, and does not appear in the external `xacpx mcp-stdio` configuration.

- The agent provides only `timeText`, `message`, and an optional mode (`temp` / `bound`); routing information such as `chatKey`, the session alias, the account, and the reply context is resolved by the daemon from the current session record.
- The time syntax, the 10-second–7-day limit, the default temporary session, `later.defaultMode`, and the channel delivery-capability check are all consistent with `/lt`.
- Group-chat permissions are also consistent with `/lt`: in group chats, only the group owner can create scheduled tasks, to prevent bypassing channel command permissions via natural language.
- If the current session's routing or the chat type / group-owner metadata cannot be recorded reliably, xacpx refuses to create (or cancels this send), to avoid creating a task by mistake using stale routing.
- Besides creating, the agent can also use `scheduled_list` to view pending tasks and `scheduled_cancel <id>` to cancel tasks. `scheduled_list` returns the **global** pending list (consistent with `/lt list`), and `scheduled_cancel` cancels by task id (the leading `#` is optional); in group chats both can likewise only be called by the group owner.

## Time Syntax

Time is parsed in the **machine's local time zone**. `<time>` is the 1–2 tokens before `<message>` in the command, and everything else is treated as message content. On successful creation it echoes back the **absolute date and day of week** to avoid ambiguity from relative expressions.

Every task must satisfy:

- Execution time **≥ current time + 10 seconds**
- Execution time **≤ current time + 7 days**

### Relative Time

English (two tokens: `in` + number-unit):

```text
/lt in 10m Check CI
/lt in 2h Check CI
/lt in 1d Summarize current progress
```

Chinese (one token, compact with no spaces):

```text
/lt 10分钟后 Check CI
/lt 2小时后 Check CI
/lt 1天后 Summarize current progress
```

Supported units:

| Category | Available forms |
|------|----------|
| Minutes | `m` / `min` / `minute` / `minutes` / `分钟` |
| Hours | `h` / `hour` / `hours` / `小时` |
| Days   | `d` / `day` / `days` / `天` |

Only **Arabic numerals + unit** are supported; decimals (`1.5h`) and Chinese numerals (`一小时后`, `半小时后`) are not supported, and the Chinese form also cannot contain spaces (`10 分钟后` is not recognized).

### Today / Tomorrow / Day After Tomorrow + Time

```text
/lt at 21:30 Continue working
/lt today 21:30 Continue working
/lt tomorrow 09:00 Look at the PR

/lt 今天 21:30 Continue working
/lt 明天 09:00 Look at the PR
/lt 后天 14:30 Continue debugging
```

- `at 21:30` is equivalent to "today 21:30."
- `today` = `今天` (the same day), `tomorrow` = `明天` (+1 day), `后天` = +2 days (no corresponding English word).
- The time format is `H:MM` or `HH:MM`, hours 0–23, minutes must be two digits (`09:00`, `9:0` is not accepted).
- If the time specified by `today` / `at` has **already passed today**, it is **rejected** and will not automatically roll over to tomorrow:

```text
Today 21:30 has already passed; please specify a future time, or use "tomorrow."
```

### Day of Week + Time

```text
/lt 周五 09:00 Look at the PR
/lt 星期五 09:00 Look at the PR
/lt fri 09:00 Look at the PR
/lt friday 09:00 Look at the PR
```

- Parsed as "the nearest occurrence of that same-named weekday within the next 7 days."
- If today is the target weekday and the time has not yet passed, it is scheduled for **today**; if the time has already passed, it rolls over to **the same day and time next week**.
- The result must still fall within 7 days.
- All 7 days in both Chinese and English are supported: `周日/周天/星期日/星期天/sun/sunday` … `周六/星期六/sat/saturday`.

### Unsupported Expressions

The first version **intentionally** does not recognize these vague or compound expressions (to avoid natural-language misinterpretation):

```text
明早   今晚   下午三点   周五晚上   下周一   月底   饭后   睡前
```

When it cannot be recognized, it gives a uniform guidance:

```text
Unable to recognize the time format.

Supported formats:
- /lt in 2h message (in 2 hours)
- /lt 30分钟后 message
- /lt tomorrow 09:00 message
- /lt 周五 09:00 message
```

## Message Content Limitations

- A scheduled task sends only a **plain prompt**.
- If `<message>` starts with `/`, it is rejected—to avoid the misconception that management commands such as `/status`, `/cancel`, `/config set` can be scheduled. If you want the agent to discuss a command, write it as a plain sentence, e.g. `/lt in 1h Please explain what /status does`.
- If there is no message content, it prompts you to add some.
- Content display uses a summary strategy: roughly up to 120 characters are shown in full; beyond that it is truncated and an ellipsis is appended.

## Successful-Creation Echo

```text
Created scheduled task #k8f2
Execution time: 2026-05-23 Sat 21:30
Temporary session (backend · codex)
Content: Check CI
```

With `--bind`, the session line shows the bound session:

```text
Created scheduled task #k8f2
Execution time: 2026-05-23 Sat 21:30
Session: backend-codex
Content: Check CI
```

## When the Channel Does Not Support It

If the current channel has not yet implemented the scheduled message delivery capability, creation is rejected:

```text
The current channel does not yet support scheduled tasks; no task was created.

Reason: this channel has not yet implemented the scheduled message delivery capability, so when the task comes due the result cannot be sent back to the original chat.
Please switch to a channel that supports scheduled tasks before using /lt.
```

This kind of failure occurs at the creation stage; it is not written to `state.json`, and it does not wait until the task comes due to be marked as failed.

## View and Cancel

```text
/lt list          # global pending tasks, not limited to the current chat/session, and shows the execution session (temporary session or bound session)
/lt cancel k8f2   # cancel; the id works with or without #, case-insensitive
/lt cancel #k8f2
```

List example:

```text
Pending scheduled tasks:

#k8f2  2026-05-23 Sat 21:30  Temporary session (backend · codex)
Check whether CI has recovered

#p91a  2026-05-24 Sun 09:00  Session: frontend-claude
Continue organizing yesterday's issues
```

When there are no pending tasks, it shows: `There are currently no pending scheduled tasks.`

### CLI View and Cancel

If the current channel is unavailable, you cannot send messages, or you just want to manage local tasks from your computer's terminal, you can use the CLI to view and cancel pending tasks:

```bash
xacpx later list
xacpx later cancel k8f2
xacpx lt list
xacpx lt cancel #k8f2
```

The CLI only provides management capability: it supports `list` / `cancel`, does not support creating scheduled tasks, and will not trigger channel delivery.

## Triggering and Task States

When it comes due:

1. First, a visible **notification** is sent to the original chat (`Executing scheduled task #id …`, indicating whether the execution session is a temporary session or a bound session).
2. Then the content is delivered as a plain prompt for execution: temporary mode runs in a newly created temporary session and destroys that session once it finishes; bind mode delivers to the bound session. In both modes the agent's reply is pushed back to that chat through the existing channel routing.

Task state machine:

| State | Meaning |
|------|------|
| `pending` | Waiting for execution (`/lt list` shows only this category) |
| `triggering` | Currently executing (claimed, in delivery) |
| `executed` | Dispatched for execution |
| `cancelled` | Cancelled by `/lt cancel` |
| `missed` | Found to be already expired and not executed at startup → not re-executed, only marked |
| `failed` | Delivery failed (e.g. the bound session does not exist, the temporary session's agent/workspace has been deregistered, the transport is unavailable) |

- **Missed compensation**: if the daemon is not running when the task comes due, after restart it finds pending tasks with `execute_at < now` and marks them as `missed`, and **does not** re-send them—to avoid old tasks from hours/days ago suddenly firing after a restart.
- **Crash safety**: a task interrupted in `triggering` is marked `failed` after restart and will not be triggered again.
- The first version **does not retry** and does not provide a history-query command.

## Delivery Reachability Notes (Important)

Both the "notification" and the "agent reply" at trigger time rely on the channel's outbound push capability:

- WeChat's outbound push depends on the session context window. A task scheduled far out (close to 7 days) with no new messages from the user during that period may be **unable to push** when it comes due; in that case the task is recorded as `failed` and logged.
- If sending the notification fails but there is still a usable delivery context (e.g. only the mid quota is exhausted), the task is **not cancelled**: the agent runs as usual, and the final result is delivered via the final quota.
- Only when it is "completely undeliverable" (no usable account / context) is it aborted without running the agent.

If you need a task scheduled far in the future, it's recommended to confirm there will still be recent interaction by then, or shorten the schedule.

## Permission Model

The first version assumes a "trusted channel / personal tool":

- In private chat, all of `/later` is available.
- In group chat, `/later` (creation), `/lt list`, and `/lt cancel` are control-type commands available **only to the group owner**; `/later` (help with no arguments) is available to everyone.
- Anyone who can run `/lt list` can cancel any pending task. `/lt list` is **global** and will show summaries of tasks created in other chats along with their execution sessions—this is a deliberate v1 trade-off.

## Non-Goals (Not in the First Version)

- Periodic / repeated tasks
- Delaying execution of xacpx commands that start with `/`
- Complex natural-language times (明早, 今晚, 下周一, 月底 …)
- Re-execution of missed tasks, retry on failure
- History-query commands, a graphical maintenance interface

## Help

```text
/later          # in-chat help
/help later     # help topic (with aliases, examples, constraints)
```
