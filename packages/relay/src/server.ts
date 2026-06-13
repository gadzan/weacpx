import { serve, type ServerType } from "@hono/node-server";
import { WebSocketServer } from "ws";

import {
  MSG, type ControlEventDto, type InstanceEventPayload, type InstanceNoticePayload, type RelayEnvelope,
} from "@ganglion/xacpx-relay-protocol";

import { createSqlDriver, initSchema, type SqlDriver } from "./db.js";
import { AccountStore } from "./stores/accounts.js";
import { InstanceStore } from "./stores/instances.js";
import { MessageStore } from "./stores/messages.js";
import { InstanceGateway } from "./gateway/instance-gateway.js";
import { WebGateway } from "./gateway/web-gateway.js";
import { createApp } from "./http/app.js";

export interface RelayRuntime {
  db: SqlDriver;
  accounts: AccountStore;
  instances: InstanceStore;
  messages: MessageStore;
  gateway: InstanceGateway;
  webGateway: WebGateway;
  app: ReturnType<typeof createApp>;
  close(): void;
}

export interface CreateRuntimeOptions {
  webRoot?: string;
}

/** Testable assembly without any network listener. */
export async function createRelayRuntime(dbPath: string, options: CreateRuntimeOptions = {}): Promise<RelayRuntime> {
  const db = await createSqlDriver(dbPath);
  initSchema(db);
  const accounts = new AccountStore(db);
  const instances = new InstanceStore(db);
  const messages = new MessageStore(db);
  const webGateway = new WebGateway();

  // Accumulate streaming turn output per (instance, session); flush to history on finish.
  const turnBuffers = new Map<string, string>();
  const key = (instanceId: string, alias: string) => `${instanceId}\0${alias}`;

  const gateway = new InstanceGateway({
    instances,
    onStatusChange: (instanceId, accountId, online) => {
      if (!online) {
        const prefix = `${instanceId}\0`;
        for (const k of turnBuffers.keys()) if (k.startsWith(prefix)) turnBuffers.delete(k);
      }
      webGateway.broadcast(accountId, { kind: "instance-status", instanceId, online });
    },
    onEvent: (instanceId, accountId, envelope: RelayEnvelope) => {
      if (envelope.type === MSG.instanceEvent) {
        const event = (envelope.payload as InstanceEventPayload).event as ControlEventDto;
        webGateway.broadcast(accountId, { kind: "control-event", instanceId, event });
        if (event.type === "turn-output") {
          const k = key(instanceId, event.sessionAlias);
          turnBuffers.set(k, (turnBuffers.get(k) ?? "") + event.chunk);
        } else if (event.type === "turn-finished") {
          const k = key(instanceId, event.sessionAlias);
          const text = turnBuffers.get(k);
          turnBuffers.delete(k);
          if (text) messages.append(instanceId, event.sessionAlias, "out", text);
        }
      } else if (envelope.type === MSG.instanceNotice) {
        webGateway.broadcast(accountId, { kind: "notice", instanceId, notice: envelope.payload as InstanceNoticePayload });
      }
    },
  });

  const app = createApp({ accounts, instances, messages, gateway, webRoot: options.webRoot });
  return { db, accounts, instances, messages, gateway, webGateway, app, close: () => db.close() };
}

export interface StartRelayOptions {
  dbPath: string;
  httpPort: number;
  wsPort: number;
  host?: string;
}

export interface RunningRelay {
  runtime: RelayRuntime;
  httpPort: number;
  wsPort: number;
  close(): Promise<void>;
}

export async function startRelayServer(options: StartRelayOptions): Promise<RunningRelay> {
  const runtime = await createRelayRuntime(options.dbPath);
  const host = options.host ?? "0.0.0.0";

  // serve() returns the server synchronously; listeningListener fires when bound.
  const httpServer: ServerType = await new Promise((resolve, reject) => {
    let server: ServerType;
    try {
      server = serve(
        { fetch: runtime.app.fetch, port: options.httpPort, hostname: host },
        () => resolve(server),
      );
    } catch (err) {
      reject(err);
    }
  });

  const wss = new WebSocketServer({ port: options.wsPort, host });
  await new Promise<void>((resolve) => wss.on("listening", () => resolve()));
  wss.on("connection", (socket) => runtime.gateway.handleConnection(socket));

  const httpPort = (httpServer.address() as { port: number }).port;
  const wsPort = (wss.address() as { port: number }).port;
  return {
    runtime,
    httpPort,
    wsPort,
    close: async () => {
      await new Promise<void>((resolve) => wss.close(() => resolve()));
      await new Promise<void>((resolve) => httpServer.close(() => resolve()));
      runtime.close();
    },
  };
}
