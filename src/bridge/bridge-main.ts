import { createInterface } from "node:readline";

import { normalizeBridgeNonInteractivePermissions, normalizeBridgePermissionMode } from "./bridge-env";
import { BridgeServer } from "./bridge-server";
import { BridgeRuntime } from "./bridge-runtime";

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

for await (const line of input) {
  const response = await server.handleLine(line, (chunk) => {
    process.stdout.write(chunk);
  });
  process.stdout.write(response);
}
