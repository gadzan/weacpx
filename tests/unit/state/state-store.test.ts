import { expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { StateStore } from "../../../src/state/state-store";

test("returns an empty state when the file is missing", async () => {
  const dir = await mkdtemp(join(tmpdir(), "weacpx-state-"));
  const store = new StateStore(join(dir, "state.json"));

  await expect(store.load()).resolves.toEqual({
    sessions: {},
    chat_contexts: {},
  });

  await rm(dir, { recursive: true, force: true });
});

test("persists sessions and chat context", async () => {
  const dir = await mkdtemp(join(tmpdir(), "weacpx-state-"));
  const path = join(dir, "state.json");
  const store = new StateStore(path);
  const state = {
    sessions: {
      "api-fix": {
        alias: "api-fix",
        agent: "codex",
        workspace: "backend",
        transport_session: "backend:api-fix",
        created_at: "2026-03-24T10:00:00.000Z",
        last_used_at: "2026-03-24T10:00:00.000Z",
      },
    },
    chat_contexts: {
      "wx:user": {
        current_session: "api-fix",
      },
    },
  };

  await store.save(state);
  await expect(store.load()).resolves.toEqual(state);

  await rm(dir, { recursive: true, force: true });
});

test("treats an empty state file as empty state", async () => {
  const dir = await mkdtemp(join(tmpdir(), "weacpx-state-"));
  const path = join(dir, "state.json");
  const store = new StateStore(path);

  await Bun.write(path, "");
  await expect(store.load()).resolves.toEqual({
    sessions: {},
    chat_contexts: {},
  });

  await rm(dir, { recursive: true, force: true });
});
