import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { CommandRouter } from "./commands/command-router";
import { ConfigStore } from "./config/config-store";
import { ensureConfigExists } from "./config/ensure-config";
import { loadConfig } from "./config/load-config";
import { resolveAcpxCommand } from "./config/resolve-acpx-command";
import { ConsoleAgent } from "./console-agent";
import type { LoggingLevel } from "./config/types";
import { createAppLogger, type AppLogger } from "./logging/app-logger";
import { SessionService } from "./sessions/session-service";
import { StateStore } from "./state/state-store";
import { runConsole } from "./run-console";
import { spawnAcpxBridgeClient } from "./transport/acpx-bridge/acpx-bridge-client";
import { AcpxBridgeTransport } from "./transport/acpx-bridge/acpx-bridge-transport";
import { AcpxCliTransport } from "./transport/acpx-cli/acpx-cli-transport";
import type { SessionTransport } from "./transport/types";
import { loadWeixinSdk } from "./weixin-sdk";

export interface RuntimePaths {
  configPath: string;
  statePath: string;
}

export interface AppRuntime {
  agent: ConsoleAgent;
  router: CommandRouter;
  sessions: SessionService;
  stateStore: StateStore;
  configStore: ConfigStore;
  logger: AppLogger;
  dispose: () => Promise<void>;
}

interface RuntimeDeps {
  createCliTransport?: (command: string) => SessionTransport;
  createBridgeTransport?: () => Promise<SessionTransport>;
  defaultLoggingLevel?: LoggingLevel;
  loggerNow?: () => Date;
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
  const state = await stateStore.load();
  const sessions = new SessionService(config, stateStore, state);
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
  const router = new CommandRouter(sessions, transport, config, configStore, logger);
  const agent = new ConsoleAgent(router, logger);

  return {
    agent,
    router,
    sessions,
    stateStore,
    configStore,
    logger,
    dispose: async () => {
      if ("dispose" in transport && typeof transport.dispose === "function") {
        await transport.dispose();
      }
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

  return {
    configPath: process.env.WEACPX_CONFIG ?? `${home}/.weacpx/config.json`,
    statePath: process.env.WEACPX_STATE ?? `${home}/.weacpx/state.json`,
  };
}

function resolveBridgeEntryPath(): string {
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
