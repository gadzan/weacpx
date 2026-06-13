import { serve, type ServerType } from "@hono/node-server";
import { WebSocketServer } from "ws";

import { createSqlDriver, initSchema, type SqlDriver } from "./db.js";
import { AccountStore } from "./stores/accounts.js";
import { InstanceStore } from "./stores/instances.js";
import { InstanceGateway } from "./gateway/instance-gateway.js";
import { createApp } from "./http/app.js";

export interface RelayRuntime {
  db: SqlDriver;
  accounts: AccountStore;
  instances: InstanceStore;
  gateway: InstanceGateway;
  app: ReturnType<typeof createApp>;
  close(): void;
}

/** Testable assembly without any network listener. */
export async function createRelayRuntime(dbPath: string): Promise<RelayRuntime> {
  const db = await createSqlDriver(dbPath);
  initSchema(db);
  const accounts = new AccountStore(db);
  const instances = new InstanceStore(db);
  const gateway = new InstanceGateway({ instances });
  const app = createApp({ accounts, instances, gateway });
  return { db, accounts, instances, gateway, app, close: () => db.close() };
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
