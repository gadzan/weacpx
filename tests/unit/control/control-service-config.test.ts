import { expect, test } from "bun:test";
import { ControlService } from "../../../src/control/control-service";

function makeDeps() {
  const created: Array<{ name: string; cwd: string; description?: string }> = [];
  const deps = {
    agents: {
      list: () => [
        { name: "codex", driver: "codex" },
        { name: "claude", driver: "claude" },
      ],
    },
    workspaces: {
      list: () => [{ name: "home", cwd: "/Users/me", description: "home dir" }],
      create: async (name: string, cwd: string, description?: string) => {
        created.push({ name, cwd, description });
        return { name, cwd, ...(description ? { description } : {}) };
      },
    },
    events: { emit: () => {} },
  };
  return { deps, created };
}

test("listAgents returns configured agents", () => {
  const { deps } = makeDeps();
  const control = new ControlService(deps as never);
  expect(control.listAgents()).toEqual([
    { name: "codex", driver: "codex" },
    { name: "claude", driver: "claude" },
  ]);
});

test("listWorkspaces returns configured workspaces", () => {
  const { deps } = makeDeps();
  const control = new ControlService(deps as never);
  expect(control.listWorkspaces()).toEqual([{ name: "home", cwd: "/Users/me", description: "home dir" }]);
});

test("createWorkspace persists via the workspace creator and returns the dto", async () => {
  const { deps, created } = makeDeps();
  const control = new ControlService(deps as never);
  const result = await control.createWorkspace("backend", "/srv/backend", "api");
  expect(result).toEqual({ name: "backend", cwd: "/srv/backend", description: "api" });
  expect(created).toEqual([{ name: "backend", cwd: "/srv/backend", description: "api" }]);
});

test("createWorkspace works without a description", async () => {
  const { deps } = makeDeps();
  const control = new ControlService(deps as never);
  const result = await control.createWorkspace("scratch", "/tmp/scratch");
  expect(result).toEqual({ name: "scratch", cwd: "/tmp/scratch" });
});
