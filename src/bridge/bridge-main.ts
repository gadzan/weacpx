import { createInterface } from "node:readline";

import { BridgeServer } from "./bridge-server";
import { BridgeRuntime } from "./bridge-runtime";

const server = new BridgeServer(new BridgeRuntime(process.env.WEACPX_BRIDGE_ACPX_COMMAND ?? "acpx"));
const input = createInterface({
  input: process.stdin,
  crlfDelay: Infinity,
});

for await (const line of input) {
  const response = await server.handleLine(line);
  process.stdout.write(response);
}
