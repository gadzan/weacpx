import { expect, test } from "bun:test";

import { reapQueueOwners, type ReapTarget } from "../../../src/transport/queue-owner-reaper";

const target = (transportSession: string, cwd = "/tmp/backend"): ReapTarget => ({
  agent: "codex",
  cwd,
  transportSession,
});

test("resolves the record id and terminates the owner for each target", async () => {
  const terminated: string[] = [];
  const result = await reapQueueOwners("acpx", [target("backend:api"), target("backend:docs")], {
    resolveRecordId: async (_cmd, t) => `record-${t.transportSession}`,
    terminate: async (recordId) => {
      terminated.push(recordId);
    },
  });

  expect(terminated.sort()).toEqual(["record-backend:api", "record-backend:docs"]);
  expect(result.terminated).toBe(2);
});

test("deduplicates targets that share a transport session", async () => {
  const resolved: string[] = [];
  await reapQueueOwners(
    "acpx",
    [target("backend:api"), target("backend:api"), target("backend:docs")],
    {
      resolveRecordId: async (_cmd, t) => {
        resolved.push(t.transportSession);
        return `record-${t.transportSession}`;
      },
      terminate: async () => {},
    },
  );

  expect(resolved.sort()).toEqual(["backend:api", "backend:docs"]);
});

test("skips targets whose record id resolves to null", async () => {
  const terminated: string[] = [];
  const result = await reapQueueOwners("acpx", [target("backend:api"), target("backend:docs")], {
    resolveRecordId: async (_cmd, t) => (t.transportSession === "backend:api" ? null : "record-docs"),
    terminate: async (recordId) => {
      terminated.push(recordId);
    },
  });

  expect(terminated).toEqual(["record-docs"]);
  expect(result.terminated).toBe(1);
});

test("swallows resolver and terminate errors so one bad session never blocks the rest", async () => {
  const terminated: string[] = [];
  const result = await reapQueueOwners(
    "acpx",
    [target("backend:resolve-fail"), target("backend:terminate-fail"), target("backend:ok")],
    {
      resolveRecordId: async (_cmd, t) => {
        if (t.transportSession === "backend:resolve-fail") throw new Error("show failed");
        return `record-${t.transportSession}`;
      },
      terminate: async (recordId) => {
        if (recordId === "record-backend:terminate-fail") throw new Error("kill failed");
        terminated.push(recordId);
      },
    },
  );

  expect(terminated).toEqual(["record-backend:ok"]);
  expect(result.terminated).toBe(1);
});

test("returns within the timeout instead of hanging on a stuck resolver", async () => {
  const start = Date.now();
  const result = await reapQueueOwners("acpx", [target("backend:hang"), target("backend:ok")], {
    timeoutMs: 50,
    resolveRecordId: async (_cmd, t) => {
      if (t.transportSession === "backend:hang") {
        await new Promise(() => {}); // never resolves
      }
      return `record-${t.transportSession}`;
    },
    terminate: async () => {},
  });

  expect(Date.now() - start).toBeLessThan(2000);
  // The non-hanging target still gets reaped before the timeout fires.
  expect(result.terminated).toBe(1);
});
