import { defineStore } from "pinia";
import { ref } from "vue";
import { isErrorPayload, type AgentDto, type SessionDto, type WebServerEvent, type WorkspaceDto } from "@ganglion/xacpx-relay-protocol";
import { api, ApiError } from "../api/client";

// An instance-side RPC error comes back as a 200 with an `{error:{code,message}}`
// payload (the gateway resolves, it does not reject), so api.rpc won't throw.
// Surface it as a real rejection so callers (the create-session dialog) can show it.
function unwrap<T>(result: T | { error: { code: string; message: string } }): T {
  if (isErrorPayload(result)) throw new Error(result.error.message || result.error.code);
  return result;
}

export interface InstanceView {
  id: string;
  name: string;
  online: boolean;
  lastSeenAt: string | null;
  sessions: SessionDto[];
  agents: AgentDto[];
  workspaces: WorkspaceDto[];
}

export const useInstancesStore = defineStore("instances", () => {
  const instances = ref<InstanceView[]>([]);

  async function loadInstances(): Promise<void> {
    const { instances: rows } = await api.get<{ instances: Array<Omit<InstanceView, "sessions" | "agents" | "workspaces">> }>("/api/instances");
    instances.value = rows.map((r) => {
      const prev = byId(r.id);
      return { ...r, sessions: prev?.sessions ?? [], agents: prev?.agents ?? [], workspaces: prev?.workspaces ?? [] };
    });
  }

  async function loadSessions(instanceId: string): Promise<void> {
    const { sessions } = await api.rpc<{ sessions: SessionDto[] }>(instanceId, "control.sessions.list");
    const inst = byId(instanceId);
    if (inst) inst.sessions = sessions;
  }

  // Pull the instance's configured agents + workspaces to drive the create-session
  // form's dropdowns. Called when the dialog opens.
  async function loadFormOptions(instanceId: string): Promise<void> {
    const [{ agents }, { workspaces }] = await Promise.all([
      api.rpc<{ agents: AgentDto[] }>(instanceId, "control.agents.list"),
      api.rpc<{ workspaces: WorkspaceDto[] }>(instanceId, "control.workspaces.list"),
    ]);
    const inst = byId(instanceId);
    if (inst) {
      inst.agents = agents;
      inst.workspaces = workspaces;
    }
  }

  async function createWorkspace(instanceId: string, name: string, cwd: string, description?: string): Promise<WorkspaceDto> {
    const { workspace } = unwrap(await api.rpc<{ workspace: WorkspaceDto }>(instanceId, "control.workspaces.create", { name, cwd, description }));
    const inst = byId(instanceId);
    if (inst && !inst.workspaces.some((w) => w.name === workspace.name)) inst.workspaces = [...inst.workspaces, workspace];
    return workspace;
  }

  // A dashboard-created session now runs the full acpx transport lifecycle, so a cold
  // agent start can block the create RPC past the gateway's 120s timeout (504). The
  // session is usually still created server-side and arrives via `sessions-changed`,
  // so a timeout is reported as `{pending:true}` (not a hard error). Every other
  // failure — including the instance-side `{error}` payload surfaced by `unwrap` —
  // is a real failure and rethrows.
  async function createSession(instanceId: string, alias: string, agent: string, workspace: string): Promise<{ pending: boolean }> {
    try {
      unwrap(await api.rpc(instanceId, "control.sessions.create", { alias, agent, workspace }));
    } catch (e) {
      if (e instanceof ApiError && (e.status === 504 || e.code === "timeout")) return { pending: true };
      throw e;
    }
    await loadSessions(instanceId);
    return { pending: false };
  }

  async function removeSession(instanceId: string, alias: string): Promise<void> {
    await api.rpc(instanceId, "control.sessions.remove", { alias });
    await loadSessions(instanceId);
  }

  function applyEvent(event: WebServerEvent): void {
    if (event.kind === "instance-status") {
      const inst = byId(event.instanceId);
      if (inst) inst.online = event.online;
    } else if (event.kind === "control-event" && event.event.type === "sessions-changed") {
      void loadSessions(event.instanceId).catch(() => {});
    }
  }

  function byId(id: string): InstanceView | undefined {
    return instances.value.find((i) => i.id === id);
  }

  return { instances, loadInstances, loadSessions, loadFormOptions, createWorkspace, createSession, removeSession, applyEvent, byId };
});
