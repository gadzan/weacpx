import { createInterface } from "node:readline";

import { normalizeBridgeNonInteractivePermissions, normalizeBridgePermissionMode } from "./bridge-env";
import { BridgeServer } from "./bridge-server";
import { BridgeRuntime } from "./bridge-runtime";

type BridgeInput = AsyncIterable<string> & {
  close(): void;
};

type BridgeWriter = (chunk: string) => boolean | void;

type BridgeLineHandler = {
  handleLine(line: string, writeLine?: (line: string) => void): Promise<string>;
};

export async function processBridgeInput(options: {
  input: BridgeInput;
  server: BridgeLineHandler;
  write: BridgeWriter;
}): Promise<void> {
  const pendingWrites = new Set<Promise<void>>();
  let firstError: unknown;

  for await (const line of options.input) {
    const pendingWrite = (async () => {
      const response = await options.server.handleLine(line, (chunk) => {
        options.write(chunk);
      });
      options.write(response);
    })();
    const observedPendingWrite = pendingWrite.catch((error) => {
      if (firstError === undefined) {
        firstError = error;
        options.input.close();
      }
    });

    pendingWrites.add(pendingWrite);
    void observedPendingWrite.finally(() => {
      pendingWrites.delete(pendingWrite);
    });
  }

  await Promise.allSettled(pendingWrites);

  if (firstError !== undefined) {
    throw firstError;
  }
}

export async function runBridgeMain(): Promise<void> {
  const server = new BridgeServer(
    new BridgeRuntime(process.env.WEACPX_BRIDGE_ACPX_COMMAND ?? "acpx", undefined, undefined, {
      permissionMode: normalizeBridgePermissionMode(process.env.WEACPX_BRIDGE_PERMISSION_MODE),
      nonInteractivePermissions: normalizeBridgeNonInteractivePermissions(
        process.env.WEACPX_BRIDGE_NON_INTERACTIVE_PERMISSIONS,
      ),
    }),
  );
  const input = createInterface({
    input: process.stdin,
    crlfDelay: Infinity,
  });

  await processBridgeInput({
    input,
    server,
    write: (chunk) => {
      process.stdout.write(chunk);
    },
  });
}

if (import.meta.main) {
  await runBridgeMain();
}
