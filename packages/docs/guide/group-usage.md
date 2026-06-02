# Group Usage

## Overview

xacpx supports running agent sessions inside group chats. The orchestration system lets you manage **task groups** — sets of related agent tasks that can be cancelled, cleaned up, or deleted as a unit. This page covers group setup (bot membership and mentions), the permission model, how normal sessions behave in groups, and the three task-group management commands and when to use each one.

Quick reference:

| Command | Effect | Affects running tasks? |
|---|---|---|
| `/group cancel <groupId>` | Stop all in-progress work in a group | Yes |
| `/groups clean` | Bulk-remove safely finished groups under the current coordinator thread | No |
| `/group delete <groupId>` | Remove a single safely finished group | No |

One-line summary:
- **cancel** — stop work that is still running.
- **clean** — batch-remove shells of groups that have already finished.
- **delete** — remove one safely finished group shell.

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

Task groups are used with the orchestration system to manage batches of parallel or sequential agent tasks. Each group has a `groupId`.

#### `/group cancel <groupId>`

Cancels all in-progress tasks within the group. The group itself is preserved so you can inspect results, continue clean-up, or make decisions based on partial output.

```text
/group cancel review-batch
```

Use this when:
- The group's direction was wrong and you want to stop it.
- You want to stop execution but retain context for review.
- You are not sure whether the group can be deleted yet — stop it first, then decide.

#### `/groups clean`

Bulk-removes all safely completed group shells under the current coordinator thread. Only touches groups that are empty or fully finished with clean-up complete. Does not cancel or touch any running groups.

```text
/groups clean
```

Use this when:
- You want to clear out completed group shells in one step.
- You do not want to run `/group delete` individually for each finished group.
- You only want to affect the current coordinator thread, not groups from other threads.

#### `/group delete <groupId>`

Removes a single group. Only allowed when the group is in a safe state:
- It is empty (no tasks ever created in it), or
- It is fully finished with clean-up complete and no remaining active tasks.

When deleting a safely completed group, xacpx also:
- Clears the terminal task records for the group.
- Releases worker bindings that are no longer in use.

```text
/group delete review-batch
```

**Deletion is rejected in two situations:**

*Situation A — active tasks remain:*

If the group still has running or pending tasks, `/group delete` is refused. The correct sequence:

1. `/group cancel <groupId>` — stop the running tasks.
2. Wait for all tasks in the group to reach a terminal state.
3. `/group delete <groupId>` — now the delete is allowed.

*Situation B — tasks finished but clean-up is not yet complete:*

If the group has reached its final state but the coordinator's final result-collection step (fan-in / injection clean-up) has not completed, the delete is still rejected. Options:
- Continue the current coordinator thread to allow clean-up to finish naturally.
- Wait for the clean-up to complete, then delete.

## Best practices

**Decision flow for a group:**

1. Is this group still running?
   - Yes → `/group cancel <groupId>` first.
   - No → proceed to step 2.
2. Has this group finished clean-up safely?
   - No → continue the coordinator thread and wait for clean-up to complete.
   - Yes → `/group delete <groupId>`, or run `/groups clean` to clear all finished groups at once.

**Independent examples** (each line is a standalone action, not a sequence to run together):

```text
/group cancel review-batch   # stop the running work in review-batch (group is kept)
/group delete review-batch   # remove review-batch once it is safely finished
/groups clean                # sweep all safely finished groups under this thread at once
```

Note that `/groups clean` and `/group delete <groupId>` are alternatives: once a group is safely finished, `/groups clean` already removes it, so a follow-up `/group delete` for the same group is unnecessary (and would fail because the group no longer exists).

**Inspect before acting:** When viewing `/group` details:
- Group has `running` tasks → cancel first.
- Group has no active tasks → consider deleting.
- Group appears finished but reports clean-up pending → wait for clean-up, then delete.

**Stick to one coordinator thread per clean operation.** `/groups clean` only touches groups under the current coordinator thread. If you have multiple coordinator threads, clean each thread separately to avoid unintended cross-thread changes.
