import { expect, test } from "bun:test";
import { mkdtemp, rm, stat } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { StateStore } from "../../../src/state/state-store";

test("returns an empty state when the file is missing", async () => {
  const dir = await mkdtemp(join(tmpdir(), "weacpx-state-"));
  const store = new StateStore(join(dir, "state.json"));

  await expect(store.load()).resolves.toEqual({
    sessions: {},
    chat_contexts: {},
    orchestration: {
      tasks: {},
      workerBindings: {},
      groups: {},
      humanQuestionPackages: {},
      coordinatorQuestionState: {},
      coordinatorRoutes: {},
      externalCoordinators: {},
    },
  });

  await rm(dir, { recursive: true, force: true });
});

test("persists sessions and chat context", async () => {
  const dir = await mkdtemp(join(tmpdir(), "weacpx-state-"));
  const path = join(dir, "state.json");
  const store = new StateStore(path);
  const state = {
    sessions: {
      "api-fix": {
        alias: "api-fix",
        agent: "codex",
        workspace: "backend",
        transport_session: "backend:api-fix",
        transport_agent_command: "npx @zed-industries/codex-acp@^0.9.5",
        created_at: "2026-03-24T10:00:00.000Z",
        last_used_at: "2026-03-24T10:00:00.000Z",
      },
    },
    chat_contexts: {
      "wx:user": {
        current_session: "api-fix",
      },
    },
    orchestration: {
      tasks: {
        "task-1": {
          taskId: "task-1",
          sourceHandle: "backend:main",
          sourceKind: "human",
          coordinatorSession: "backend:main",
          workerSession: "backend:claude-reviewer:feature-x",
          workspace: "backend",
          targetAgent: "claude",
          role: "reviewer",
          task: "审查当前方案风险",
          status: "running",
          summary: "正在审查当前方案风险",
          resultText: "",
          createdAt: "2026-04-13T10:00:00.000Z",
          updatedAt: "2026-04-13T10:00:00.000Z",
        },
      },
      workerBindings: {
        "backend:claude-reviewer:feature-x": {
          sourceHandle: "backend:claude-reviewer:feature-x",
          coordinatorSession: "backend:main",
          workspace: "backend",
          targetAgent: "claude",
          role: "reviewer",
        },
      },
      groups: {},
      humanQuestionPackages: {},
      coordinatorQuestionState: {},
      coordinatorRoutes: {},
      externalCoordinators: {},
    },
  };

  await store.save(state);
  await expect(store.load()).resolves.toEqual(state);

  await rm(dir, { recursive: true, force: true });
});

test("round-trips blocker-loop state records through load", async () => {
  const dir = await mkdtemp(join(tmpdir(), "weacpx-state-"));
  const path = join(dir, "state.json");
  const store = new StateStore(path);
  const state = {
    sessions: {},
    chat_contexts: {},
    orchestration: {
      tasks: {
        "task-1": {
          taskId: "task-1",
          sourceHandle: "backend:main",
          sourceKind: "worker",
          coordinatorSession: "backend:main",
          workerSession: "backend:claude:backend:main",
          workspace: "backend",
          targetAgent: "claude",
          task: "继续处理数据库方案",
          status: "blocked",
          summary: "等待数据库方案确认",
          resultText: "",
          createdAt: "2026-04-21T10:00:00.000Z",
          updatedAt: "2026-04-21T10:01:00.000Z",
          openQuestion: {
            questionId: "question-1",
            question: "继续 SQLite 还是切 Postgres？",
            whyBlocked: "schema choice affects follow-up work",
            whatIsNeeded: "database decision",
            askedAt: "2026-04-21T10:00:30.000Z",
            status: "open",
            packageId: "package-1",
          },
        },
        "task-2": {
          taskId: "task-2",
          sourceHandle: "backend:main",
          sourceKind: "coordinator",
          coordinatorSession: "backend:main",
          workerSession: "backend:claude:backend:main",
          workspace: "backend",
          targetAgent: "claude",
          task: "确认误路由结果",
          status: "completed",
          summary: "等待 coordinator 判定",
          resultText: "result payload",
          createdAt: "2026-04-21T10:02:00.000Z",
          updatedAt: "2026-04-21T10:03:00.000Z",
          reviewPending: {
            reviewId: "review-1",
            reason: "misrouted_answer",
            createdAt: "2026-04-21T10:03:00.000Z",
            resultId: "result-1",
            resultText: "result payload",
          },
        },
        "task-3": {
          taskId: "task-3",
          sourceHandle: "backend:main",
          sourceKind: "coordinator",
          coordinatorSession: "backend:main",
          workerSession: "backend:claude:backend:main",
          workspace: "backend",
          targetAgent: "claude",
          task: "处理纠正中的 task",
          status: "running",
          summary: "等待纠正结果",
          resultText: "",
          createdAt: "2026-04-21T10:04:00.000Z",
          updatedAt: "2026-04-21T10:05:00.000Z",
          correctionPending: {
            requestedAt: "2026-04-21T10:05:00.000Z",
            reason: "misrouted_answer",
          },
        },
      },
      workerBindings: {
        "backend:claude:backend:main": {
          sourceHandle: "backend:claude:backend:main",
          coordinatorSession: "backend:main",
          workspace: "backend",
          targetAgent: "claude",
        },
      },
      groups: {},
      humanQuestionPackages: {
        "package-1": {
          packageId: "package-1",
          coordinatorSession: "backend:main",
          status: "active",
          createdAt: "2026-04-21T10:00:00.000Z",
          updatedAt: "2026-04-21T10:05:00.000Z",
          initialTaskIds: ["task-1"],
          openTaskIds: ["task-1"],
          resolvedTaskIds: ["task-3"],
          messages: [
            {
              messageId: "message-1",
              kind: "initial",
              promptText: "请确认数据库方案和文件写入边界",
              createdAt: "2026-04-21T10:00:00.000Z",
              deliveredAt: "2026-04-21T10:00:10.000Z",
              deliveredChatKey: "wx:user-1",
              deliveryAccountId: "account-1",
            },
          ],
          awaitingReplyMessageId: "message-1",
        },
      },
      coordinatorQuestionState: {
        "backend:main": {
          activePackageId: "package-1",
          queuedQuestions: [
            {
              taskId: "task-3",
              questionId: "question-3",
              enqueuedAt: "2026-04-21T10:05:00.000Z",
            },
          ],
        },
      },
      coordinatorRoutes: {
        "backend:main": {
          coordinatorSession: "backend:main",
          chatKey: "wx:user-1",
          accountId: "account-1",
          replyContextToken: "reply-token-1",
          updatedAt: "2026-04-21T10:05:00.000Z",
        },
      },
      externalCoordinators: {},
    },
  };

  await store.save(state);
  await expect(store.load()).resolves.toEqual(state);

  await rm(dir, { recursive: true, force: true });
});

test("round-trips blocker-loop state records through load", async () => {
  const dir = await mkdtemp(join(tmpdir(), "weacpx-state-"));
  const path = join(dir, "state.json");
  const store = new StateStore(path);
  const state = {
    sessions: {},
    chat_contexts: {},
    orchestration: {
      tasks: {
        "task-1": {
          taskId: "task-1",
          sourceHandle: "backend:main",
          sourceKind: "worker",
          coordinatorSession: "backend:main",
          workerSession: "backend:claude:backend:main",
          workspace: "backend",
          targetAgent: "claude",
          task: "继续处理数据库方案",
          status: "blocked",
          summary: "等待数据库方案确认",
          resultText: "",
          createdAt: "2026-04-21T10:00:00.000Z",
          updatedAt: "2026-04-21T10:01:00.000Z",
          openQuestion: {
            questionId: "question-1",
            question: "继续 SQLite 还是切 Postgres？",
            whyBlocked: "schema choice affects follow-up work",
            whatIsNeeded: "database decision",
            askedAt: "2026-04-21T10:00:30.000Z",
            status: "open",
            packageId: "package-1",
          },
        },
        "task-2": {
          taskId: "task-2",
          sourceHandle: "backend:main",
          sourceKind: "coordinator",
          coordinatorSession: "backend:main",
          workerSession: "backend:claude:backend:main",
          workspace: "backend",
          targetAgent: "claude",
          task: "确认误路由结果",
          status: "completed",
          summary: "等待 coordinator 判定",
          resultText: "result payload",
          createdAt: "2026-04-21T10:02:00.000Z",
          updatedAt: "2026-04-21T10:03:00.000Z",
          reviewPending: {
            reviewId: "review-1",
            reason: "misrouted_answer",
            createdAt: "2026-04-21T10:03:00.000Z",
            resultId: "result-1",
            resultText: "result payload",
          },
        },
        "task-3": {
          taskId: "task-3",
          sourceHandle: "backend:main",
          sourceKind: "coordinator",
          coordinatorSession: "backend:main",
          workerSession: "backend:claude:backend:main",
          workspace: "backend",
          targetAgent: "claude",
          task: "处理纠正中的 task",
          status: "running",
          summary: "等待纠正结果",
          resultText: "",
          createdAt: "2026-04-21T10:04:00.000Z",
          updatedAt: "2026-04-21T10:05:00.000Z",
          correctionPending: {
            requestedAt: "2026-04-21T10:05:00.000Z",
            reason: "misrouted_answer",
          },
        },
      },
      workerBindings: {
        "backend:claude:backend:main": {
          sourceHandle: "backend:claude:backend:main",
          coordinatorSession: "backend:main",
          workspace: "backend",
          targetAgent: "claude",
        },
      },
      groups: {},
      humanQuestionPackages: {
        "package-1": {
          packageId: "package-1",
          coordinatorSession: "backend:main",
          status: "active",
          createdAt: "2026-04-21T10:00:00.000Z",
          updatedAt: "2026-04-21T10:05:00.000Z",
          initialTaskIds: ["task-1"],
          openTaskIds: ["task-1"],
          resolvedTaskIds: ["task-3"],
          messages: [
            {
              messageId: "message-1",
              kind: "initial",
              promptText: "请确认数据库方案和文件写入边界",
              createdAt: "2026-04-21T10:00:00.000Z",
              deliveredAt: "2026-04-21T10:00:10.000Z",
              deliveredChatKey: "wx:user-1",
              deliveryAccountId: "account-1",
            },
          ],
          awaitingReplyMessageId: "message-1",
        },
      },
      coordinatorQuestionState: {
        "backend:main": {
          activePackageId: "package-1",
          queuedQuestions: [
            {
              taskId: "task-3",
              questionId: "question-3",
              enqueuedAt: "2026-04-21T10:05:00.000Z",
            },
          ],
        },
      },
      coordinatorRoutes: {
        "backend:main": {
          coordinatorSession: "backend:main",
          chatKey: "wx:user-1",
          accountId: "account-1",
          replyContextToken: "reply-token-1",
          updatedAt: "2026-04-21T10:05:00.000Z",
        },
      },
      externalCoordinators: {},
    },
  };

  await store.save(state);
  await expect(store.load()).resolves.toEqual(state);

  await rm(dir, { recursive: true, force: true });
});

test("loads orchestration task records with coordinator injection metadata", async () => {
  const dir = await mkdtemp(join(tmpdir(), "weacpx-state-"));
  const path = join(dir, "state.json");
  const store = new StateStore(path);

  await Bun.write(
    path,
    JSON.stringify({
      sessions: {},
      chat_contexts: {},
      orchestration: {
        tasks: {
          "task-1": {
            taskId: "task-1",
            sourceHandle: "backend:main",
            sourceKind: "coordinator",
            coordinatorSession: "backend:main",
            workerSession: "backend:worker",
            workspace: "backend",
            targetAgent: "claude",
            task: "inject result back to coordinator",
            status: "completed",
            summary: "worker result injected",
            resultText: "done",
            createdAt: "2026-04-13T10:00:00.000Z",
            updatedAt: "2026-04-13T10:05:00.000Z",
            coordinatorInjectedAt: "2026-04-13T10:06:00.000Z",
          },
        },
        workerBindings: {},
        groups: {},
      },
    }),
  );

  await expect(store.load()).resolves.toEqual({
    sessions: {},
    chat_contexts: {},
    orchestration: {
      tasks: {
        "task-1": {
          taskId: "task-1",
          sourceHandle: "backend:main",
          sourceKind: "coordinator",
          coordinatorSession: "backend:main",
          workerSession: "backend:worker",
          workspace: "backend",
          targetAgent: "claude",
          task: "inject result back to coordinator",
          status: "completed",
          summary: "worker result injected",
          resultText: "done",
          createdAt: "2026-04-13T10:00:00.000Z",
          updatedAt: "2026-04-13T10:05:00.000Z",
          coordinatorInjectedAt: "2026-04-13T10:06:00.000Z",
        },
      },
      workerBindings: {},
      groups: {},
      humanQuestionPackages: {},
      coordinatorQuestionState: {},
      coordinatorRoutes: {},
      externalCoordinators: {},
    },
  });

  await rm(dir, { recursive: true, force: true });
});

test("loads orchestration groups and grouped tasks", async () => {
  const dir = await mkdtemp(join(tmpdir(), "weacpx-state-"));
  const path = join(dir, "state.json");
  const store = new StateStore(path);

  await Bun.write(
    path,
    JSON.stringify({
      sessions: {},
      chat_contexts: {},
      orchestration: {
        tasks: {
          "task-1": {
            taskId: "task-1",
            sourceHandle: "backend:main",
            sourceKind: "coordinator",
            coordinatorSession: "backend:main",
            workerSession: "backend:claude:backend:main",
            workspace: "backend",
            targetAgent: "claude",
            task: "review api",
            groupId: "group-review",
            status: "completed",
            summary: "done",
            resultText: "ok",
            createdAt: "2026-04-18T10:00:00.000Z",
            updatedAt: "2026-04-18T10:05:00.000Z",
          },
        },
        workerBindings: {},
        groups: {
          "group-review": {
            groupId: "group-review",
            coordinatorSession: "backend:main",
            title: "review",
            createdAt: "2026-04-18T10:00:00.000Z",
            updatedAt: "2026-04-18T10:05:00.000Z",
          },
        },
      },
    }),
  );

  await expect(store.load()).resolves.toMatchObject({
    orchestration: {
      tasks: {
        "task-1": {
          groupId: "group-review",
        },
      },
      groups: {
        "group-review": {
          title: "review",
        },
      },
    },
  });

  await rm(dir, { recursive: true, force: true });
});

test("loads orchestration task records with reliability metadata", async () => {
  const dir = await mkdtemp(join(tmpdir(), "weacpx-state-"));
  const path = join(dir, "state.json");
  const store = new StateStore(path);

  await Bun.write(
    path,
    JSON.stringify({
      sessions: {},
      chat_contexts: {},
      orchestration: {
        tasks: {
          "task-1": {
            taskId: "task-1",
            sourceHandle: "wx:user",
            sourceKind: "human",
            coordinatorSession: "backend:main",
            workerSession: "backend:worker",
            workspace: "backend",
            targetAgent: "claude",
            task: "keep track of reliability metadata",
            status: "running",
            summary: "waiting",
            resultText: "",
            createdAt: "2026-04-13T10:00:00.000Z",
            updatedAt: "2026-04-13T10:05:00.000Z",
            cancelRequestedAt: "2026-04-13T10:01:00.000Z",
            cancelCompletedAt: "2026-04-13T10:02:00.000Z",
            lastCancelError: "transport busy",
            noticePending: true,
            noticeSentAt: "2026-04-13T10:03:00.000Z",
            lastNoticeError: "wechat disconnected",
            injectionPending: true,
            injectionAppliedAt: "2026-04-13T10:04:00.000Z",
            lastInjectionError: "coordinator busy",
          },
        },
        workerBindings: {},
        groups: {},
      },
    }),
  );

  await expect(store.load()).resolves.toEqual({
    sessions: {},
    chat_contexts: {},
    orchestration: {
      tasks: {
        "task-1": {
          taskId: "task-1",
          sourceHandle: "wx:user",
          sourceKind: "human",
          coordinatorSession: "backend:main",
          workerSession: "backend:worker",
          workspace: "backend",
          targetAgent: "claude",
          task: "keep track of reliability metadata",
          status: "running",
          summary: "waiting",
          resultText: "",
          createdAt: "2026-04-13T10:00:00.000Z",
          updatedAt: "2026-04-13T10:05:00.000Z",
          cancelRequestedAt: "2026-04-13T10:01:00.000Z",
          cancelCompletedAt: "2026-04-13T10:02:00.000Z",
          lastCancelError: "transport busy",
          noticePending: true,
          noticeSentAt: "2026-04-13T10:03:00.000Z",
          lastNoticeError: "wechat disconnected",
          injectionPending: true,
          injectionAppliedAt: "2026-04-13T10:04:00.000Z",
          lastInjectionError: "coordinator busy",
        },
      },
      workerBindings: {},
      groups: {},
      humanQuestionPackages: {},
      coordinatorQuestionState: {},
      coordinatorRoutes: {},
      externalCoordinators: {},
    },
  });

  await rm(dir, { recursive: true, force: true });
});

test("treats an empty state file as empty state", async () => {
  const dir = await mkdtemp(join(tmpdir(), "weacpx-state-"));
  const path = join(dir, "state.json");
  const store = new StateStore(path);

  await Bun.write(path, "");
  await expect(store.load()).resolves.toEqual({
    sessions: {},
    chat_contexts: {},
    orchestration: {
      tasks: {},
      workerBindings: {},
      groups: {},
      humanQuestionPackages: {},
      coordinatorQuestionState: {},
      coordinatorRoutes: {},
      externalCoordinators: {},
    },
  });

  await rm(dir, { recursive: true, force: true });
});


test("rejects states whose sessions field is not an object", async () => {
  const dir = await mkdtemp(join(tmpdir(), "weacpx-state-"));
  const path = join(dir, "state.json");
  const store = new StateStore(path);

  await Bun.write(path, JSON.stringify({ sessions: [], chat_contexts: {} }));

  await expect(store.load()).rejects.toThrow('state file "' + path + '" must contain an object field "sessions"');

  await rm(dir, { recursive: true, force: true });
});

test("rejects states whose chat_contexts field is not an object", async () => {
  const dir = await mkdtemp(join(tmpdir(), "weacpx-state-"));
  const path = join(dir, "state.json");
  const store = new StateStore(path);

  await Bun.write(path, JSON.stringify({ sessions: {}, chat_contexts: [] }));

  await expect(store.load()).rejects.toThrow('state file "' + path + '" must contain an object field "chat_contexts"');

  await rm(dir, { recursive: true, force: true });
});

test("loads older states without orchestration as empty orchestration state", async () => {
  const dir = await mkdtemp(join(tmpdir(), "weacpx-state-"));
  const path = join(dir, "state.json");
  const store = new StateStore(path);

  await Bun.write(
    path,
    JSON.stringify({
      sessions: {},
      chat_contexts: {},
    }),
  );

  await expect(store.load()).resolves.toEqual({
    sessions: {},
    chat_contexts: {},
    orchestration: {
      tasks: {},
      workerBindings: {},
      groups: {},
      humanQuestionPackages: {},
      coordinatorQuestionState: {},
      coordinatorRoutes: {},
      externalCoordinators: {},
    },
  });

  await rm(dir, { recursive: true, force: true });
});


test("loads older orchestration state without external coordinators as empty external coordinators", async () => {
  const dir = await mkdtemp(join(tmpdir(), "weacpx-state-"));
  const path = join(dir, "state.json");
  const store = new StateStore(path);

  await Bun.write(
    path,
    JSON.stringify({
      sessions: {},
      chat_contexts: {},
      orchestration: {
        tasks: {},
        workerBindings: {},
        groups: {},
      },
    }),
  );

  const state = await store.load();
  expect(state.orchestration.externalCoordinators).toEqual({});

  await rm(dir, { recursive: true, force: true });
});

test("loads and validates external coordinator records", async () => {
  const dir = await mkdtemp(join(tmpdir(), "weacpx-state-"));
  const path = join(dir, "state.json");
  const store = new StateStore(path);

  await Bun.write(
    path,
    JSON.stringify({
      sessions: {},
      chat_contexts: {},
      orchestration: {
        tasks: {},
        workerBindings: {},
        groups: {},
        externalCoordinators: {
          "codex:backend": {
            coordinatorSession: "codex:backend",
            workspace: "backend",
            createdAt: "2026-04-28T10:00:00.000Z",
            updatedAt: "2026-04-28T10:05:00.000Z",
            defaultTargetAgent: "codex",
          },
        },
      },
    }),
  );

  await expect(store.load()).resolves.toMatchObject({
    orchestration: {
      externalCoordinators: {
        "codex:backend": {
          coordinatorSession: "codex:backend",
          workspace: "backend",
          createdAt: "2026-04-28T10:00:00.000Z",
          updatedAt: "2026-04-28T10:05:00.000Z",
          defaultTargetAgent: "codex",
        },
      },
    },
  });

  await rm(dir, { recursive: true, force: true });
});

test("rejects malformed external coordinator records", async () => {
  const dir = await mkdtemp(join(tmpdir(), "weacpx-state-"));
  const path = join(dir, "state.json");
  const store = new StateStore(path);

  await Bun.write(
    path,
    JSON.stringify({
      sessions: {},
      chat_contexts: {},
      orchestration: {
        tasks: {},
        workerBindings: {},
        groups: {},
        externalCoordinators: {
          "codex:backend": {
            coordinatorSession: "codex:backend",
            workspace: 123,
            createdAt: "2026-04-28T10:00:00.000Z",
            updatedAt: "2026-04-28T10:05:00.000Z",
          },
        },
      },
    }),
  );

  await expect(store.load()).rejects.toThrow(
    `state file "${path}" contains an invalid external coordinator at "codex:backend"`,
  );

  await rm(dir, { recursive: true, force: true });
});

test("rejects external coordinator records whose map key does not match coordinatorSession", async () => {
  const dir = await mkdtemp(join(tmpdir(), "weacpx-state-"));
  const path = join(dir, "state.json");
  const store = new StateStore(path);

  await Bun.write(
    path,
    JSON.stringify({
      sessions: {},
      chat_contexts: {},
      orchestration: {
        tasks: {},
        workerBindings: {},
        groups: {},
        externalCoordinators: {
          "codex:backend": {
            coordinatorSession: "codex:other",
            workspace: "backend",
            createdAt: "2026-04-28T10:00:00.000Z",
            updatedAt: "2026-04-28T10:05:00.000Z",
          },
        },
      },
    }),
  );

  await expect(store.load()).rejects.toThrow(
    `state file "${path}" contains an external coordinator key mismatch at "codex:backend"`,
  );

  await rm(dir, { recursive: true, force: true });
});

test("rejects external coordinator handles that collide with logical sessions in persisted state", async () => {
  const dir = await mkdtemp(join(tmpdir(), "weacpx-state-"));
  const path = join(dir, "state.json");
  const store = new StateStore(path);

  await Bun.write(
    path,
    JSON.stringify({
      sessions: {
        main: {
          alias: "main",
          agent: "codex",
          workspace: "backend",
          transport_session: "codex:backend",
          created_at: "2026-04-28T10:00:00.000Z",
          last_used_at: "2026-04-28T10:00:00.000Z",
        },
      },
      chat_contexts: {},
      orchestration: {
        tasks: {},
        workerBindings: {},
        groups: {},
        externalCoordinators: {
          "codex:backend": {
            coordinatorSession: "codex:backend",
            workspace: "backend",
            createdAt: "2026-04-28T10:00:00.000Z",
            updatedAt: "2026-04-28T10:05:00.000Z",
          },
        },
      },
    }),
  );

  await expect(store.load()).rejects.toThrow(
    `state file "${path}" contains external coordinator "codex:backend" that conflicts with a logical session`,
  );

  await rm(dir, { recursive: true, force: true });
});

test("rejects external coordinator handles that collide with worker bindings in persisted state", async () => {
  const dir = await mkdtemp(join(tmpdir(), "weacpx-state-"));
  const path = join(dir, "state.json");
  const store = new StateStore(path);

  await Bun.write(
    path,
    JSON.stringify({
      sessions: {},
      chat_contexts: {},
      orchestration: {
        tasks: {},
        workerBindings: {
          "codex:backend": {
            sourceHandle: "codex:backend",
            coordinatorSession: "backend:main",
            workspace: "backend",
            targetAgent: "codex",
          },
        },
        groups: {},
        externalCoordinators: {
          "codex:backend": {
            coordinatorSession: "codex:backend",
            workspace: "backend",
            createdAt: "2026-04-28T10:00:00.000Z",
            updatedAt: "2026-04-28T10:05:00.000Z",
          },
        },
      },
    }),
  );

  await expect(store.load()).rejects.toThrow(
    `state file "${path}" contains external coordinator "codex:backend" that conflicts with a worker binding`,
  );

  await rm(dir, { recursive: true, force: true });
});

test("rejects external coordinator handles that collide with active task worker sessions in persisted state", async () => {
  const dir = await mkdtemp(join(tmpdir(), "weacpx-state-"));
  const path = join(dir, "state.json");
  const store = new StateStore(path);

  await Bun.write(
    path,
    JSON.stringify({
      sessions: {},
      chat_contexts: {},
      orchestration: {
        tasks: {
          "task-1": {
            taskId: "task-1",
            sourceHandle: "backend:main",
            sourceKind: "coordinator",
            coordinatorSession: "backend:main",
            workerSession: "codex:backend",
            workspace: "backend",
            targetAgent: "codex",
            task: "review",
            status: "needs_confirmation",
            summary: "",
            resultText: "",
            createdAt: "2026-04-28T10:00:00.000Z",
            updatedAt: "2026-04-28T10:00:00.000Z",
          },
        },
        workerBindings: {},
        groups: {},
        externalCoordinators: {
          "codex:backend": {
            coordinatorSession: "codex:backend",
            workspace: "backend",
            createdAt: "2026-04-28T10:00:00.000Z",
            updatedAt: "2026-04-28T10:05:00.000Z",
          },
        },
      },
    }),
  );

  await expect(store.load()).rejects.toThrow(
    `state file "${path}" contains external coordinator "codex:backend" that conflicts with an active task worker session`,
  );

  await rm(dir, { recursive: true, force: true });
});

test("loads pathless external coordinators and cwd-bound task records", async () => {
  const dir = await mkdtemp(join(tmpdir(), "weacpx-state-"));
  const path = join(dir, "state.json");
  const store = new StateStore(path);

  await Bun.write(
    path,
    JSON.stringify({
      sessions: {},
      chat_contexts: {},
      orchestration: {
        tasks: {
          "task-1": {
            taskId: "task-1",
            sourceHandle: "external_codex:abcd1234",
            sourceKind: "coordinator",
            coordinatorSession: "external_codex:abcd1234",
            workerSession: "weacpx:claude:external_codex:abcd1234",
            workspace: "weacpx",
            cwd: "/repo/weacpx",
            targetAgent: "claude",
            task: "review",
            status: "running",
            summary: "",
            resultText: "",
            createdAt: "2026-04-28T10:00:00.000Z",
            updatedAt: "2026-04-28T10:00:00.000Z",
          },
        },
        workerBindings: {
          "weacpx:claude:external_codex:abcd1234": {
            sourceHandle: "weacpx:claude:external_codex:abcd1234",
            coordinatorSession: "external_codex:abcd1234",
            workspace: "weacpx",
            cwd: "/repo/weacpx",
            targetAgent: "claude",
          },
        },
        groups: {},
        externalCoordinators: {
          "external_codex:abcd1234": {
            coordinatorSession: "external_codex:abcd1234",
            createdAt: "2026-04-28T10:00:00.000Z",
            updatedAt: "2026-04-28T10:05:00.000Z",
          },
        },
      },
    }),
  );

  await expect(store.load()).resolves.toMatchObject({
    orchestration: {
      tasks: {
        "task-1": { cwd: "/repo/weacpx" },
      },
      workerBindings: {
        "weacpx:claude:external_codex:abcd1234": { cwd: "/repo/weacpx" },
      },
      externalCoordinators: {
        "external_codex:abcd1234": {
          coordinatorSession: "external_codex:abcd1234",
        },
      },
    },
  });

  await rm(dir, { recursive: true, force: true });
});

test("allows external coordinator handles that only match terminal task worker sessions in persisted state", async () => {
  const dir = await mkdtemp(join(tmpdir(), "weacpx-state-"));
  const path = join(dir, "state.json");
  const store = new StateStore(path);

  await Bun.write(
    path,
    JSON.stringify({
      sessions: {},
      chat_contexts: {},
      orchestration: {
        tasks: {
          "task-1": {
            taskId: "task-1",
            sourceHandle: "backend:main",
            sourceKind: "coordinator",
            coordinatorSession: "backend:main",
            workerSession: "codex:backend",
            workspace: "backend",
            targetAgent: "codex",
            task: "review",
            status: "completed",
            summary: "done",
            resultText: "ok",
            createdAt: "2026-04-28T10:00:00.000Z",
            updatedAt: "2026-04-28T10:00:00.000Z",
          },
        },
        workerBindings: {},
        groups: {},
        externalCoordinators: {
          "codex:backend": {
            coordinatorSession: "codex:backend",
            workspace: "backend",
            createdAt: "2026-04-28T10:00:00.000Z",
            updatedAt: "2026-04-28T10:05:00.000Z",
          },
        },
      },
    }),
  );

  await expect(store.load()).resolves.toMatchObject({
    orchestration: {
      externalCoordinators: {
        "codex:backend": {
          workspace: "backend",
        },
      },
    },
  });

  await rm(dir, { recursive: true, force: true });
});

test("rejects states whose orchestration field is not an object", async () => {
  const dir = await mkdtemp(join(tmpdir(), "weacpx-state-"));
  const path = join(dir, "state.json");
  const store = new StateStore(path);

  await Bun.write(path, JSON.stringify({ sessions: {}, chat_contexts: {}, orchestration: [] }));

  await expect(store.load()).rejects.toThrow('state file "' + path + '" must contain an object field "orchestration"');

  await rm(dir, { recursive: true, force: true });
});

test("rejects states whose orchestration.tasks field is not an object", async () => {
  const dir = await mkdtemp(join(tmpdir(), "weacpx-state-"));
  const path = join(dir, "state.json");
  const store = new StateStore(path);

  await Bun.write(
    path,
    JSON.stringify({
      sessions: {},
      chat_contexts: {},
      orchestration: {
        tasks: [],
        workerBindings: {},
      },
    }),
  );

  await expect(store.load()).rejects.toThrow('state file "' + path + '" must contain an object field "orchestration.tasks"');

  await rm(dir, { recursive: true, force: true });
});

test("rejects states whose orchestration.workerBindings field is not an object", async () => {
  const dir = await mkdtemp(join(tmpdir(), "weacpx-state-"));
  const path = join(dir, "state.json");
  const store = new StateStore(path);

  await Bun.write(
    path,
    JSON.stringify({
      sessions: {},
      chat_contexts: {},
      orchestration: {
        tasks: {},
        workerBindings: [],
      },
    }),
  );

  await expect(store.load()).rejects.toThrow('state file "' + path + '" must contain an object field "orchestration.workerBindings"');

  await rm(dir, { recursive: true, force: true });
});

test("rejects states with malformed orchestration task entries", async () => {
  const dir = await mkdtemp(join(tmpdir(), "weacpx-state-"));
  const path = join(dir, "state.json");
  const store = new StateStore(path);

  await Bun.write(
    path,
    JSON.stringify({
      sessions: {},
      chat_contexts: {},
      orchestration: {
        tasks: {
          "task-1": {
            taskId: "task-1",
            sourceHandle: "backend:main",
            sourceKind: "coordinator",
            coordinatorSession: "backend:main",
            workspace: "backend",
            targetAgent: "claude",
            task: "review",
            status: "not-a-status",
            summary: "",
            resultText: "",
            createdAt: "2026-04-13T10:00:00.000Z",
            updatedAt: "2026-04-13T10:00:00.000Z",
          },
        },
        workerBindings: {},
      },
    }),
  );

  await expect(store.load()).rejects.toThrow(
    `state file "${path}" contains an invalid orchestration task at "task-1"`,
  );

  await rm(dir, { recursive: true, force: true });
});

test("rejects states with malformed orchestration worker binding entries", async () => {
  const dir = await mkdtemp(join(tmpdir(), "weacpx-state-"));
  const path = join(dir, "state.json");
  const store = new StateStore(path);

  await Bun.write(
    path,
    JSON.stringify({
      sessions: {},
      chat_contexts: {},
      orchestration: {
        tasks: {},
        workerBindings: {
          "worker-1": {
            sourceHandle: "worker-1",
            coordinatorSession: "backend:main",
            workspace: "backend",
            targetAgent: 123,
          },
        },
      },
    }),
  );

  await expect(store.load()).rejects.toThrow(
    `state file "${path}" contains an invalid orchestration worker binding at "worker-1"`,
  );

  await rm(dir, { recursive: true, force: true });
});

test("loads orchestration task records with lastProgressAt", async () => {
  const dir = await mkdtemp(join(tmpdir(), "weacpx-state-"));
  const path = join(dir, "state.json");
  const store = new StateStore(path);

  await Bun.write(
    path,
    JSON.stringify({
      sessions: {},
      chat_contexts: {},
      orchestration: {
        tasks: {
          "task-1": {
            taskId: "task-1",
            sourceHandle: "wx:user",
            sourceKind: "human",
            coordinatorSession: "backend:main",
            workerSession: "backend:worker",
            workspace: "backend",
            targetAgent: "claude",
            task: "review",
            status: "running",
            summary: "",
            resultText: "",
            createdAt: "2026-04-18T10:00:00.000Z",
            updatedAt: "2026-04-18T10:05:00.000Z",
            lastProgressAt: "2026-04-18T10:03:00.000Z",
          },
        },
        workerBindings: {},
      },
    }),
  );

  const state = await store.load();
  expect(state.orchestration.tasks["task-1"].lastProgressAt).toBe("2026-04-18T10:03:00.000Z");

  await rm(dir, { recursive: true, force: true });
});

test("includes the state file path when JSON is malformed", async () => {
  const dir = await mkdtemp(join(tmpdir(), "weacpx-state-"));
  const path = join(dir, "state.json");
  const store = new StateStore(path);

  await Bun.write(path, "{not-json");

  await expect(store.load()).rejects.toThrow('failed to parse state file "' + path + '"');

  await rm(dir, { recursive: true, force: true });
});


test("saves state with owner-only file permissions", async () => {
  const dir = await mkdtemp(join(tmpdir(), "weacpx-state-"));
  const path = join(dir, "state.json");
  const store = new StateStore(path);

  await store.save({
    sessions: {},
    chat_contexts: {},
    orchestration: {
      tasks: {},
      workerBindings: {},
      groups: {},
      humanQuestionPackages: {},
      coordinatorQuestionState: {},
      coordinatorRoutes: {},
      externalCoordinators: {},
    },
  });

  if (process.platform !== "win32") {
    expect((await stat(path)).mode & 0o777).toBe(0o600);
  }

  await rm(dir, { recursive: true, force: true });
});

test("rejects states with malformed session records", async () => {
  const dir = await mkdtemp(join(tmpdir(), "weacpx-state-"));
  const path = join(dir, "state.json");
  await Bun.write(
    path,
    JSON.stringify({
      sessions: {
        broken: {
          alias: "broken",
          agent: "codex",
          workspace: "backend",
          transport_session: 123,
          created_at: "2026-01-01T00:00:00.000Z",
          last_used_at: "2026-01-01T00:00:00.000Z",
        },
      },
      chat_contexts: {},
      orchestration: {
        tasks: {},
        workerBindings: {},
        groups: {},
        humanQuestionPackages: {},
        coordinatorQuestionState: {},
        coordinatorRoutes: {},
        externalCoordinators: {},
      },
    }),
  );

  await expect(new StateStore(path).load()).rejects.toThrow("malformed session record");
  await rm(dir, { recursive: true, force: true });
});

test("rejects states with malformed chat context records", async () => {
  const dir = await mkdtemp(join(tmpdir(), "weacpx-state-"));
  const path = join(dir, "state.json");
  await Bun.write(
    path,
    JSON.stringify({
      sessions: {},
      chat_contexts: {
        "wx:user": { current_session: 42 },
      },
      orchestration: {
        tasks: {},
        workerBindings: {},
        groups: {},
        humanQuestionPackages: {},
        coordinatorQuestionState: {},
        coordinatorRoutes: {},
        externalCoordinators: {},
      },
    }),
  );

  await expect(new StateStore(path).load()).rejects.toThrow("malformed chat context record");
  await rm(dir, { recursive: true, force: true });
});
