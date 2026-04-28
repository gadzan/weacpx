import { randomUUID } from "node:crypto";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { CommandRouter } from "./commands/command-router";
import { ConfigStore } from "./config/config-store";
import { ensureConfigExists } from "./config/ensure-config";
import { loadConfig } from "./config/load-config";
import { resolveAcpxCommand } from "./config/resolve-acpx-command";
import { ConsoleAgent } from "./console-agent";
import type { AppConfig, LoggingLevel } from "./config/types";
import { createAppLogger, type AppLogger } from "./logging/app-logger";
import { resolveDaemonOrchestrationSocketPath, resolveRuntimeDirFromConfigPath } from "./daemon/daemon-files";
import type { OrchestrationTaskRecord } from "./orchestration/orchestration-types";
import { createOrchestrationEndpoint, resolveOrchestrationEndpoint } from "./orchestration/orchestration-ipc";
import { OrchestrationServer } from "./orchestration/orchestration-server";
import { OrchestrationService } from "./orchestration/orchestration-service";
import { buildCoordinatorPrompt } from "./orchestration/build-coordinator-prompt";
import { buildWorkerAnswerPrompt, buildWorkerTaskPrompt } from "./orchestration/worker-prompts";
import { SessionService } from "./sessions/session-service";
import { StateStore } from "./state/state-store";
import { runConsole } from "./run-console";
import { spawnAcpxBridgeClient } from "./transport/acpx-bridge/acpx-bridge-client";
import { AcpxBridgeTransport } from "./transport/acpx-bridge/acpx-bridge-transport";
import { AcpxCliTransport } from "./transport/acpx-cli/acpx-cli-transport";
import type { SessionTransport } from "./transport/types";
import { listWeixinAccountIds, resolveWeixinAccount, sendMessageWeixin } from "./weixin";
import { deliverOrchestrationTaskNotice } from "./weixin/messaging/deliver-orchestration-task-notice";
import { deliverCoordinatorMessage as deliverCoordinatorMessageWeixin } from "./weixin/messaging/deliver-coordinator-message";
import { isQuotaDeferredError } from "./weixin/messaging/quota-errors";
import { getContextToken } from "./weixin/messaging/inbound";
import { loadWeixinSdk } from "./weixin-sdk";
import { ProgressLineBuffer } from "./orchestration/progress-line-parser";
import { renderTaskHeartbeat, renderTaskProgress } from "./formatting/render-text";
import { deliverOrchestrationTaskProgress } from "./weixin/messaging/deliver-orchestration-task-progress";
import { QuotaManager } from "./weixin/messaging/quota-manager";

export interface RuntimePaths {
  configPath: string;
  statePath: string;
  orchestrationSocketPath?: string;
}

export interface AppRuntime {
  agent: ConsoleAgent;
  router: CommandRouter;
  sessions: SessionService;
  stateStore: StateStore;
  configStore: ConfigStore;
  logger: AppLogger;
  quota: QuotaManager;
  orchestration: {
    service: OrchestrationService;
    server: OrchestrationServer;
    endpoint: ReturnType<typeof resolveOrchestrationEndpoint>;
  };
  dispose: () => Promise<void>;
}

interface RuntimeDeps {
  createCliTransport?: (command: string) => SessionTransport;
  createBridgeTransport?: () => Promise<SessionTransport>;
  defaultLoggingLevel?: LoggingLevel;
  loggerNow?: () => Date;
  sendOrchestrationNotice?: (task: OrchestrationTaskRecord) => Promise<void>;
  sendCoordinatorMessage?: (input: {
    coordinatorSession: string;
    chatKey: string;
    accountId?: string;
    replyContextToken?: string;
    text: string;
  }) => Promise<void>;
}

function startProgressHeartbeat(
  orchestration: OrchestrationService,
  config: AppConfig,
  logger: AppLogger,
  quota: QuotaManager,
): NodeJS.Timeout | undefined {
  const thresholdSeconds = config.orchestration.progressHeartbeatSeconds;
  if (thresholdSeconds <= 0) {
    return undefined;
  }

  return setInterval(async () => {
    try {
      const tasks = await orchestration.listHeartbeatTasks(thresholdSeconds);
      for (const task of tasks) {
        try {
          const elapsedSeconds =
            (Date.now() - new Date(task.lastProgressAt ?? task.createdAt).getTime()) / 1000;
          if (task.chatKey && task.replyContextToken) {
            await deliverOrchestrationTaskProgress(task, renderTaskHeartbeat(task, elapsedSeconds), {
              listAccountIds: () => listWeixinAccountIds(),
              resolveAccount: (accountId) => resolveWeixinAccount(accountId),
              getContextToken: (accountId, userId) => getContextToken(accountId, userId),
              reserveMidSegment: (chatKey) => quota.reserveMidSegment(chatKey),
              logger,
            });
          }
          await orchestration.recordTaskProgress(task.taskId);
        } catch (error) {
          await logger.error("orchestration.heartbeat.send_failed", "failed to send heartbeat", {
            taskId: task.taskId,
            message: error instanceof Error ? error.message : String(error),
          });
        }
      }
    } catch (error) {
      await logger.error("orchestration.heartbeat.check_failed", "heartbeat check failed", {
        message: error instanceof Error ? error.message : String(error),
      });
    }
  }, 60_000);
}

export async function buildApp(paths: RuntimePaths, deps: RuntimeDeps = {}): Promise<AppRuntime> {
  await ensureConfigExists(paths.configPath);
  const configStore = new ConfigStore(paths.configPath);
  const config = await loadConfig(paths.configPath, {
    defaultLoggingLevel: deps.defaultLoggingLevel,
  });
  const logger = createAppLogger({
    filePath: resolveAppLogPath(paths.configPath),
    level: config.logging.level,
    maxSizeBytes: config.logging.maxSizeBytes,
    maxFiles: config.logging.maxFiles,
    retentionDays: config.logging.retentionDays,
    now: deps.loggerNow,
  });
  await logger.cleanup();
  const acpxCommand = resolveAcpxCommand({ configuredCommand: config.transport.command });
  const stateStore = new StateStore(paths.statePath);
  let state = await stateStore.load();
  const sessions = new SessionService(config, stateStore, state);
  const pendingWorkerDispatches = new Set<Promise<void>>();
  const transport =
    config.transport.type === "acpx-bridge"
      ? await (deps.createBridgeTransport?.() ??
          Promise.resolve(
            new AcpxBridgeTransport(
              await spawnAcpxBridgeClient({
                acpxCommand,
                bridgeEntryPath: resolveBridgeEntryPath(),
                permissionMode: config.transport.permissionMode,
                nonInteractivePermissions: config.transport.nonInteractivePermissions,
              }),
            ),
          ))
      : (deps.createCliTransport?.(acpxCommand) ??
          new AcpxCliTransport({ ...config.transport, command: acpxCommand }));
  // Per-chatKey outbound quota (WeChat 24h budget). Shared across SDK boundary
  // (inbound reset / final reservation) and orchestration deliveries (mid gate).
  // Observer pipes every quota decision into the AppLogger so the path is
  // visible at runtime (otherwise quota throttling is invisible to operators).
  const quota = new QuotaManager({
    onInbound: (chatKey) => {
      void logger.info("weixin.quota.inbound_reset", "inbound message reset quota window", {
        chatKey,
      });
    },
    onMidReserved: (chatKey, snap) => {
      void logger.info("weixin.quota.mid_reserved", "mid-segment quota reserved", {
        chatKey,
        mid_used: snap.midUsed,
        remaining: snap.remaining,
      });
    },
    onMidRejected: (chatKey, snap) => {
      void logger.info("weixin.quota.mid_rejected", "mid-segment quota exhausted; segment dropped/deferred", {
        chatKey,
        mid_used: snap.midUsed,
        remaining: snap.remaining,
      });
    },
    onFinalReserved: (chatKey, snap) => {
      void logger.info("weixin.quota.final_reserved", "final-tier quota reserved", {
        chatKey,
        mid_used: snap.midUsed,
        final_used: snap.finalUsed,
        remaining: snap.remaining,
      });
    },
    onFinalRejected: (chatKey, snap) => {
      void logger.error(
        "weixin.quota.final_rejected",
        "final-tier quota exhausted; final message dropped",
        {
          chatKey,
          mid_used: snap.midUsed,
          final_used: snap.finalUsed,
        },
      );
    },
  });
  let orchestration!: OrchestrationService;
  let sendCompletionNotice!: (task: OrchestrationTaskRecord) => Promise<void>;
  const sendCoordinatorMessage =
    deps.sendCoordinatorMessage ?? createDefaultCoordinatorMessageSender(logger, quota);

  const wakeCoordinatorLocks = new Map<string, Promise<void>>();
  const wakeCoordinator = async (coordinatorSession: string): Promise<void> => {
    const previous = wakeCoordinatorLocks.get(coordinatorSession) ?? Promise.resolve();
    const next = previous.then(
      () => doWakeCoordinator(coordinatorSession),
      () => doWakeCoordinator(coordinatorSession),
    );
    const tracked = next.catch(() => {});
    wakeCoordinatorLocks.set(coordinatorSession, tracked);
    void tracked.finally(() => {
      if (wakeCoordinatorLocks.get(coordinatorSession) === tracked) {
        wakeCoordinatorLocks.delete(coordinatorSession);
      }
    });
    return next;
  };
  const doWakeCoordinator = async (coordinatorSession: string): Promise<void> => {
    const session = await sessions.getPreferredSessionForTransport(coordinatorSession);
    if (!session) {
      throw new Error(`no logical session is attached to coordinator "${coordinatorSession}"`);
    }
    session.mcpCoordinatorSession = coordinatorSession;

    const { promptText, taskIds, groupIds } = await buildCoordinatorPrompt({
      orchestration,
      coordinatorSession,
    });
    if (promptText.trim().length === 0) {
      return;
    }

    // Auto-wake has no inbound message bound to it, so the coordinator's
    // reply has nowhere to go unless we push it via the recorded route.
    const route = state.orchestration.coordinatorRoutes?.[coordinatorSession];
    const pushReply: ((text: string) => Promise<void>) | undefined =
      route && route.chatKey
        ? async (text) => {
            await sendCoordinatorMessage({
              coordinatorSession,
              chatKey: route.chatKey,
              ...(route.accountId ? { accountId: route.accountId } : {}),
              ...(route.replyContextToken ? { replyContextToken: route.replyContextToken } : {}),
              text,
            });
          }
        : undefined;

    try {
      await transport.prompt(session, promptText, pushReply);
      if (groupIds.length > 0) {
        await orchestration.markCoordinatorGroupsInjected(groupIds);
      }
      if (taskIds.length > 0) {
        await orchestration.markTaskInjectionApplied(taskIds);
      }
    } catch (error) {
      if (isQuotaDeferredError(error)) {
        // Deferred (not failed): leave injectionPending so the next wake retries.
        await logger.info(
          "orchestration.coordinator_wake.deferred",
          "coordinator wake deferred because outbound quota is exhausted",
          {
            coordinatorSession,
            chatKey: error.chatKey,
            taskIds: taskIds.join(","),
            groupIds: groupIds.join(","),
          },
        );
        return;
      }
      const errorMessage = error instanceof Error ? error.message : String(error);
      if (groupIds.length > 0) {
        await orchestration.markCoordinatorGroupsInjectionFailed(groupIds, errorMessage);
      }
      if (taskIds.length > 0) {
        await orchestration.markTaskInjectionFailed(taskIds, errorMessage);
      }
      throw error;
    }
  };

  const finalizeWorkerTurn = async (input: {
    taskId: string;
    workerSession: string;
    status: "completed" | "failed";
    summary?: string;
    resultText?: string;
  }): Promise<OrchestrationTaskRecord | undefined> => {
    const currentTask = await orchestration.getTask(input.taskId);
    if (!currentTask) {
      return undefined;
    }
    if (currentTask.workerSession !== input.workerSession) {
      await logger.debug(
        "orchestration.worker.reply_skipped",
        "skipping worker turn finalization because the task worker changed",
        {
          taskId: input.taskId,
          expectedWorkerSession: input.workerSession,
          actualWorkerSession: currentTask.workerSession,
        },
      );
      return undefined;
    }
    if (currentTask.status !== "running") {
      await logger.debug(
        "orchestration.worker.reply_skipped",
        "skipping worker turn finalization because the task is no longer running",
        {
          taskId: input.taskId,
          workerSession: input.workerSession,
          status: currentTask.status,
        },
      );
      return undefined;
    }

    try {
      return await orchestration.recordWorkerReply({
        taskId: input.taskId,
        sourceHandle: input.workerSession,
        status: input.status,
        ...(input.summary !== undefined ? { summary: input.summary } : {}),
        ...(input.resultText !== undefined ? { resultText: input.resultText } : {}),
      });
    } catch (error) {
      await logger.error(
        "orchestration.worker.reply_record_failed",
        "failed to persist worker task result",
        {
          taskId: input.taskId,
          workerSession: input.workerSession,
          message: error instanceof Error ? error.message : String(error),
        },
      );
      return undefined;
    }
  };

  const launchWorkerTurn = (input: {
    taskId: string;
    workerSession: string;
    coordinatorSession: string;
    targetAgent: string;
    workspace: string;
    promptText: string;
  }): void => {
    const session = sessions.resolveSession(
      input.workerSession,
      input.targetAgent,
      input.workspace,
      input.workerSession,
    );
    session.mcpCoordinatorSession = input.coordinatorSession;
    session.mcpSourceHandle = input.workerSession;
    const workerDispatch = (async () => {
      let taskRecord: OrchestrationTaskRecord | undefined;
      try {
        const progressBuffer = new ProgressLineBuffer();
        const result = await transport.prompt(
          session,
          input.promptText,
          async (chunk) => {
            const summaries = progressBuffer.feed(chunk);
            for (const summary of summaries) {
              try {
                await orchestration.recordTaskProgress(input.taskId);
                const taskState = await orchestration.getTask(input.taskId);
                if (taskState?.chatKey && taskState.replyContextToken) {
                  await deliverOrchestrationTaskProgress(
                    taskState,
                    renderTaskProgress(taskState, summary),
                    {
                      listAccountIds: () => listWeixinAccountIds(),
                      resolveAccount: (accountId) => resolveWeixinAccount(accountId),
                      getContextToken: (accountId, userId) => getContextToken(accountId, userId),
                      reserveMidSegment: (chatKey) => quota.reserveMidSegment(chatKey),
                      logger,
                    },
                  );
                }
              } catch (error) {
                await logger.error(
                  "orchestration.progress.send_failed",
                  "failed to send task progress",
                  {
                    taskId: input.taskId,
                    message: error instanceof Error ? error.message : String(error),
                  },
                );
              }
            }
          },
        );
        taskRecord = await finalizeWorkerTurn({
          taskId: input.taskId,
          workerSession: input.workerSession,
          status: "completed",
          resultText: result.text,
        });
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        await logger.error("orchestration.worker.dispatch_failed", "worker task dispatch failed", {
          taskId: input.taskId,
          workerSession: input.workerSession,
          message,
        });
        taskRecord = await finalizeWorkerTurn({
          taskId: input.taskId,
          workerSession: input.workerSession,
          status: "failed",
          summary: message,
          resultText: "",
        });
      }

      if (taskRecord && shouldNotifyTaskCompletion(taskRecord)) {
        try {
          await sendCompletionNotice(taskRecord);
        } catch (noticeError) {
          await logger.error("orchestration.worker.notice_failed", "failed to notify delegated task result", {
            taskId: input.taskId,
            workerSession: input.workerSession,
            message: noticeError instanceof Error ? noticeError.message : String(noticeError),
          });
        }
      }

      if (taskRecord) {
        try {
          await wakeCoordinator(taskRecord.coordinatorSession);
        } catch (wakeError) {
          await logger.error(
            "orchestration.worker.wake_failed",
            "failed to wake coordinator after worker task finished",
            {
              taskId: input.taskId,
              coordinatorSession: taskRecord.coordinatorSession,
              message: wakeError instanceof Error ? wakeError.message : String(wakeError),
            },
          );
        }
      }
    })();
    pendingWorkerDispatches.add(workerDispatch);
    void workerDispatch.finally(() => {
      pendingWorkerDispatches.delete(workerDispatch);
    });
  };

  orchestration = new OrchestrationService({
    now: deps.loggerNow ?? (() => new Date()),
    createId: () => randomUUID(),
    config,
    loadState: async () => JSON.parse(JSON.stringify(state)) as typeof state,
    saveState: async (nextState) => {
      await stateStore.save(nextState);
      state = nextState;
    },
    ensureWorkerSession: async ({ workerSession, targetAgent, workspace, coordinatorSession }) => {
      const session = sessions.resolveSession(workerSession, targetAgent, workspace, workerSession);
      session.mcpCoordinatorSession = coordinatorSession;
      session.mcpSourceHandle = workerSession;
      await transport.ensureSession(session);
      return workerSession;
    },
    dispatchWorkerTask: async ({ workerSession, coordinatorSession, targetAgent, workspace, taskId, role, task }) => {
      launchWorkerTurn({
        taskId,
        workerSession,
        coordinatorSession,
        targetAgent,
        workspace,
        promptText: buildWorkerTaskPrompt({ taskId, workerSession, role, task }),
      });
    },
    cancelWorkerTask: async ({ workerSession, targetAgent, workspace }) => {
      const session = sessions.resolveSession(workerSession, targetAgent, workspace, workerSession);
      const result = await transport.cancel(session);
      if (!result.cancelled) {
        throw new Error(result.message || "worker task cancel was not acknowledged");
      }
    },
    resumeWorkerTask: async ({ taskId, workerSession, coordinatorSession, targetAgent, workspace, answer }) => {
      launchWorkerTurn({
        taskId,
        workerSession,
        coordinatorSession,
        targetAgent,
        workspace,
        promptText: buildWorkerAnswerPrompt(answer),
      });
    },
    wakeCoordinatorSession: async ({ coordinatorSession }) => {
      await wakeCoordinator(coordinatorSession);
    },
    deliverCoordinatorMessage: async (input) => {
      await sendCoordinatorMessage(input);
    },
    interruptWorkerTask: async ({ workerSession, targetAgent, workspace }) => {
      const session = sessions.resolveSession(workerSession, targetAgent, workspace, workerSession);
      const result = await transport.cancel(session);
      if (!result.cancelled) {
        throw new Error(result.message || "worker interrupt was not acknowledged");
      }
    },
    findReusableWorkerSession: async ({ coordinatorSession, workspace, targetAgent, role }) => {
      const binding = Object.entries(state.orchestration.workerBindings).find(
        ([, current]) =>
          current.coordinatorSession === coordinatorSession &&
          current.workspace === workspace &&
          current.targetAgent === targetAgent &&
          current.role === role,
      );
      return binding?.[0] ?? null;
    },
    logger,
  });
  sendCompletionNotice =
    deps.sendOrchestrationNotice ?? createDefaultOrchestrationNoticeSender(orchestration, logger, quota);
  for (const task of await orchestration.listPendingTaskNotices()) {
    try {
      await sendCompletionNotice(task);
    } catch (error) {
      await logger.error("orchestration.notice.replay_failed", "failed to replay pending orchestration notice", {
        taskId: task.taskId,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }
  const progressHeartbeatInterval = startProgressHeartbeat(orchestration, config, logger, quota);
  const orchestrationEndpoint = createOrchestrationEndpoint(
    paths.orchestrationSocketPath ?? resolveOrchestrationSocketPathFromConfigPath(paths.configPath),
  );
  const orchestrationServer = new OrchestrationServer(orchestrationEndpoint, orchestration);
  const router = new CommandRouter(sessions, transport, config, configStore, logger, undefined, orchestration, quota);
  const agent = new ConsoleAgent(router, logger);

  return {
    agent,
    router,
    sessions,
    stateStore,
    configStore,
    logger,
    quota,
    orchestration: {
      service: orchestration,
      server: orchestrationServer,
      endpoint: orchestrationEndpoint,
    },
    dispose: async () => {
      if (progressHeartbeatInterval !== undefined) {
        clearInterval(progressHeartbeatInterval);
      }
      await Promise.allSettled([...pendingWorkerDispatches]);
      if ("dispose" in transport && typeof transport.dispose === "function") {
        await transport.dispose();
      }
      await logger.flush();
    },
  };
}

export async function main(): Promise<void> {
  const paths = resolveRuntimePaths();

  try {
    await runConsole(paths, {
      buildApp,
      loadWeixinSdk,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(
      [
        "Failed to start weacpx console.",
        `config: ${paths.configPath}`,
        `state: ${paths.statePath}`,
        message,
      ].join("\n"),
    );
  }
}

if (import.meta.main) {
  await main();
}

export function resolveRuntimePaths(): RuntimePaths {
  const home = process.env.HOME ?? homedir();
  if (!home) {
    throw new Error("Unable to resolve the current user home directory");
  }

  const configPath = process.env.WEACPX_CONFIG ?? `${home}/.weacpx/config.json`;
  const runtimeDir = join(dirname(configPath), "runtime");

  return {
    configPath,
    statePath: process.env.WEACPX_STATE ?? `${home}/.weacpx/state.json`,
    orchestrationSocketPath:
      process.env.WEACPX_ORCHESTRATION_SOCKET ?? resolveDaemonOrchestrationSocketPath(runtimeDir),
  };
}

export function resolveBridgeEntryPath(): string {
  if (import.meta.url.includes("/dist/")) {
    return fileURLToPath(new URL("./bridge/bridge-main.js", import.meta.url));
  }

  return fileURLToPath(new URL("./bridge/bridge-main.ts", import.meta.url));
}

function resolveAppLogPath(configPath: string): string {
  const rootDir = dirname(configPath);
  const runtimeDir = join(rootDir, "runtime");
  return join(runtimeDir, "app.log");
}

function resolveOrchestrationSocketPathFromConfigPath(configPath: string): string {
  const runtimeDir = resolveRuntimeDirFromConfigPath(configPath);
  return resolveDaemonOrchestrationSocketPath(runtimeDir);
}


function shouldNotifyTaskCompletion(task: OrchestrationTaskRecord): boolean {
  return Boolean(task.chatKey && task.replyContextToken && (task.status === "completed" || task.status === "failed"));
}

function createDefaultOrchestrationNoticeSender(
  orchestration: OrchestrationService,
  logger: AppLogger,
  quota: QuotaManager,
): (task: OrchestrationTaskRecord) => Promise<void> {
  return async (task) => {
    await deliverOrchestrationTaskNotice(task, {
      listAccountIds: () => listWeixinAccountIds(),
      resolveAccount: (accountId) => resolveWeixinAccount(accountId),
      getContextToken: (accountId, userId) => getContextToken(accountId, userId),
      markDelivered: async (taskId, accountId) => {
        await orchestration.markTaskNoticeDelivered(taskId, accountId);
      },
      markFailed: async (taskId, errorMessage) => {
        await orchestration.markTaskNoticeFailed({ taskId, errorMessage });
      },
      reserveFinal: (chatKey) => quota.reserveFinal(chatKey),
      logger,
    });
  };
}

function createDefaultCoordinatorMessageSender(
  logger: AppLogger,
  quota: QuotaManager,
): NonNullable<RuntimeDeps["sendCoordinatorMessage"]> {
  return async (input) =>
    await deliverCoordinatorMessageWeixin(input, {
      listAccountIds: () => listWeixinAccountIds(),
      resolveAccount: (accountId) => resolveWeixinAccount(accountId),
      getContextToken: (accountId, userId) => getContextToken(accountId, userId),
      sendMessage: sendMessageWeixin,
      reserveMidSegment: (chatKey) => quota.reserveMidSegment(chatKey),
      logger,
    });
}
