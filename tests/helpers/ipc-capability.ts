import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createServer } from "node:net";

let cachedLocalListenAvailable: Promise<boolean> | undefined;
let warned = false;

export async function canListenForLocalIpc(): Promise<boolean> {
  cachedLocalListenAvailable ??= probeLocalListen();
  return await cachedLocalListenAvailable;
}

export async function skipIfLocalIpcUnavailable(testScope: string): Promise<boolean> {
  if (await canListenForLocalIpc()) {
    return false;
  }

  if (!warned) {
    warned = true;
    console.warn(
      `[skip] Local IPC listen is unavailable in this test environment (listen returned EPERM/EACCES). `
        + `${testScope} use real node:net listeners, so these socket integration assertions are skipped; `
        + `pure RPC/service/MCP unit tests still run.`,
    );
  }
  return true;
}

async function probeLocalListen(): Promise<boolean> {
  const dir = await mkdtemp(join(tmpdir(), "weacpx-ipc-probe-"));
  const socketPath = join(dir, "probe.sock");
  const server = createServer();

  try {
    await new Promise<void>((resolve, reject) => {
      server.once("error", reject);
      server.once("listening", resolve);
      server.listen(socketPath);
    });
    return true;
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code === "EPERM" || code === "EACCES") {
      return false;
    }
    throw error;
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    await rm(dir, { recursive: true, force: true });
  }
}
