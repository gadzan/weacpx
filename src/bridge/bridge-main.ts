import { createInterface } from "node:readline";

import { BridgeServer } from "./bridge-server";
import { BridgeRuntime } from "./bridge-runtime";

const server = new BridgeServer(
  new BridgeRuntime(process.env.WEACPX_BRIDGE_ACPX_COMMAND ?? "acpx", undefined, undefined, {
    permissionMode:
      process.env.WEACPX_BRIDGE_PERMISSION_MODE === "approve-reads" ||
      process.env.WEACPX_BRIDGE_PERMISSION_MODE === "deny-all"
        ? process.env.WEACPX_BRIDGE_PERMISSION_MODE
        : "approve-all",
    nonInteractivePermissions:
      process.env.WEACPX_BRIDGE_NON_INTERACTIVE_PERMISSIONS === "deny" ? "deny" : "fail",
  }),
);
const input = createInterface({
  input: process.stdin,
  crlfDelay: Infinity,
});

for await (const line of input) {
  const response = await server.handleLine(line);
  process.stdout.write(response);
}
