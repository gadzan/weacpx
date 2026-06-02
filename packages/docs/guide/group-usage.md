# Group Usage

## Overview

xacpx supports running agent sessions inside group chats. The orchestration system lets you fan out related agent sub-tasks into **task groups** and track them collectively. This page covers group setup (bot membership and mentions), the permission model, how normal sessions behave in groups, and how to stop and clean up group work.

Quick reference for the commands most relevant to running and winding down group work:

| Command | Effect | Affects running tasks? |
|---|---|---|
| `/group cancel <groupId>` | Cancel all unfinished tasks in a group | Yes |
| `/tasks clean` | Remove finished tasks and stale bindings under the current coordinator | No |

> There is **no** `/group delete` and **no** `/groups clean`. To stop a group's unfinished work use `/group cancel <groupId>`; to clean up finished tasks use `/tasks clean`. See the full surface in [Command Reference](/reference/commands).

## Setup

Group-chat usage requires:

1. The bot is added to the group.
2. `requireMention` is configured to match your preference (see [Channel Management](/guide/channel-management)).
3. You have group owner permissions for control commands (see [Mention and command behavior](#mention-and-command-behavior) below).

## Mention and command behavior

In group chats, xacpx routes messages based on the channel's `requireMention` setting:

- **`requireMention: true` (default for Feishu/Yuanbao):** Only messages that @-mention the bot are processed. Plain messages are ignored.
- **`requireMention: false`:** All messages in the group are processed.

**Permission model:** Control-class commands in group chats — including task-group management, `/later` (create/cancel), and other admin operations — are restricted to the group owner. Help commands (e.g. `/help`, `/later` with no arguments) are available to all members.

## Session management in groups

Sessions in a group chat work the same as in a direct message: xacpx maps an alias to an agent and workspace, and routes plain messages to the current active session.

**Agent session commands work identically in groups** — `/ss`, `/use`, `/status`, `/cancel`, `/stop` — subject to the `requireMention` setting and group owner restrictions for control commands.

### Task groups

Task groups let you fan out multiple independent sub-tasks in parallel from a coordinator session and track them collectively. Each group has a `groupId`. Group commands require an active current session, which acts as the coordinator.

The core group lifecycle commands are:

| Command | Description |
|---|---|
| `/group new <title>` | Create a task group |
| `/groups` | List task groups (supports `--status`, `--stuck`, `--sort`, `--order` filters) |
| `/group <id>` | Show a single group's details |
| `/group add <groupId> <agent> <task>` | Add a sub-task to a group |
| `/group cancel <groupId>` | Cancel all unfinished tasks in the group |

#### Stop a group's work — `/group cancel <groupId>`

Cancels all unfinished tasks within the group. Already-finished tasks are left as-is, and the group itself is preserved so you can still inspect results and partial output.

```text
/group cancel review-batch
```

Use this when:
- The group's direction was wrong and you want to stop it.
- You want to stop execution but retain context for review.

#### Clean up finished work — `/tasks clean`

There is no per-group delete command. To tidy up after a group finishes, use `/tasks clean`, which removes **finished tasks** (completed, failed, cancelled) and stale worker bindings under the current coordinator. It is **task-scoped, not group-scoped** — it sweeps finished tasks across the coordinator rather than deleting a specific group shell.

```text
/tasks clean
```

`/tasks clean` does not cancel anything that is still running. If a group still has unfinished tasks, cancel them first with `/group cancel <groupId>`, then run `/tasks clean` to clear the finished records.

To inspect tasks before cleaning, use `/tasks` (with optional `--status`, `--stuck`, `--sort`, `--order` filters) and `/task <id>` for a single task's details.

## Best practices

**Winding down a group:**

1. Is the group still running work you no longer want?
   - Yes → `/group cancel <groupId>` to stop its unfinished tasks.
   - No → proceed to step 2.
2. Want to tidy up finished task records?
   - Run `/tasks clean` to remove finished tasks and stale bindings under the current coordinator.

**Typical commands:**

```text
/group cancel review-batch   # stop the unfinished work in review-batch (group is kept)
/tasks clean                 # remove finished tasks and stale bindings under this coordinator
```

`/tasks clean` only ever touches **finished** tasks. Run `/group cancel <groupId>` first if a group still has running work you want stopped; then `/tasks clean` clears the finished records.

**Inspect before acting:** Use `/groups` to see groups and their status, `/group <id>` for one group's details, and `/tasks` (optionally `/task <id>`) to review individual tasks before cleaning.

**`/tasks clean` is scoped to the current coordinator.** It cleans finished tasks under the coordinator session you are in, not across other coordinators. Run it from each coordinator session whose finished tasks you want to clear.
