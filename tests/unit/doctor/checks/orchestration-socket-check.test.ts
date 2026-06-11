import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { expect, test } from "bun:test";

import { checkOrchestrationSocket } from "../../../../src/doctor/checks/orchestration-socket-check";

async function createTempHome(): Promise<string> {
  return await mkdtemp(join(tmpdir(), "xacpx-orch-socket-check-"));
}

test("orchestration socket check skips and never probes when the daemon is stopped", async () => {
  const home = await createTempHome();
  let probed = false;

  try {
    const result = await checkOrchestrationSocket({
      home,
      getDaemonStatus: async () => ({ state: "stopped" }),
      canConnectToEndpoint: async () => {
        probed = true;
        return true;
      },
    });

    expect(result.id).toBe("orchestration-socket");
    expect(result.severity).toBe("skip");
    expect(result.summary).toContain("daemon stopped");
    expect(probed).toBe(false);
  } finally {
    await rm(home, { recursive: true, force: true });
  }
});

test("orchestration socket check passes when the daemon is running and the endpoint accepts connections", async () => {
  const home = await createTempHome();

  try {
    const result = await checkOrchestrationSocket({
      home,
      getDaemonStatus: async () => ({ state: "running", pid: 4242 }),
      canConnectToEndpoint: async () => true,
    });

    expect(result.severity).toBe("pass");
    expect(result.summary).toContain("accepting connections");
    expect(result.fixes ?? []).toEqual([]);
  } finally {
    await rm(home, { recursive: true, force: true });
  }
});

test("orchestration socket check fails with endpoint path and a restart suggestion when there is definitively no listener", async () => {
  const home = await createTempHome();
  let probedPath: string | undefined;

  try {
    const result = await checkOrchestrationSocket({
      home,
      getDaemonStatus: async () => ({ state: "running", pid: 4242 }),
      canConnectToEndpoint: async (path) => {
        probedPath = path;
        return false;
      },
    });

    expect(result.severity).toBe("fail");
    expect(result.summary).toContain("not accepting connections");
    expect(result.suggestions ?? []).toContain("run: xacpx restart");
    expect(result.details?.join("\n") ?? "").toContain(probedPath!);
    // restart is a user action; no automated fix is attached.
    expect(result.fixes ?? []).toEqual([]);
  } finally {
    await rm(home, { recursive: true, force: true });
  }
});

test("orchestration socket check treats an indeterminate daemon as a live daemon and probes it", async () => {
  const home = await createTempHome();
  let probed = false;

  try {
    const result = await checkOrchestrationSocket({
      home,
      getDaemonStatus: async () => ({ state: "indeterminate", pid: 4242 }),
      canConnectToEndpoint: async () => {
        probed = true;
        return true;
      },
    });

    expect(probed).toBe(true);
    expect(result.severity).toBe("pass");
  } finally {
    await rm(home, { recursive: true, force: true });
  }
});

test("orchestration socket check resolves the endpoint from the runtime dir and probes that path", async () => {
  const home = await createTempHome();
  let probedPath: string | undefined;

  try {
    await checkOrchestrationSocket({
      home,
      getDaemonStatus: async () => ({ state: "running", pid: 4242 }),
      resolveOrchestrationEndpoint: (runtimeDir) => ({ kind: "unix", path: join(runtimeDir, "custom.sock") }),
      canConnectToEndpoint: async (path) => {
        probedPath = path;
        return true;
      },
    });

    expect(probedPath?.endsWith("custom.sock")).toBe(true);
  } finally {
    await rm(home, { recursive: true, force: true });
  }
});

test("orchestration socket check skips with the error in details when the daemon status read throws", async () => {
  const home = await createTempHome();
  let probed = false;

  try {
    const result = await checkOrchestrationSocket({
      home,
      getDaemonStatus: async () => {
        throw new Error("status read exploded");
      },
      canConnectToEndpoint: async () => {
        probed = true;
        return true;
      },
    });

    expect(result.severity).toBe("skip");
    expect(result.summary).toContain("could not be read");
    expect(result.details?.join("\n") ?? "").toContain("status read exploded");
    expect(probed).toBe(false);
  } finally {
    await rm(home, { recursive: true, force: true });
  }
});

test("orchestration socket check skips without crashing when the probe throws", async () => {
  const home = await createTempHome();

  try {
    const result = await checkOrchestrationSocket({
      home,
      getDaemonStatus: async () => ({ state: "running", pid: 4242 }),
      canConnectToEndpoint: async () => {
        throw new Error("probe exploded");
      },
    });

    expect(result.severity).toBe("skip");
    expect(result.summary).toContain("could not be probed");
    expect(result.details?.join("\n") ?? "").toContain("probe exploded");
  } finally {
    await rm(home, { recursive: true, force: true });
  }
});
