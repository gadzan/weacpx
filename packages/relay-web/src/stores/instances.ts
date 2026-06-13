import { defineStore } from "pinia";
import { ref } from "vue";
import type { SessionDto, WebServerEvent } from "@ganglion/xacpx-relay-protocol";
import { api } from "../api/client";

export interface InstanceView {
  id: string;
  name: string;
  online: boolean;
  lastSeenAt: string | null;
  sessions: SessionDto[];
}

export const useInstancesStore = defineStore("instances", () => {
  const instances = ref<InstanceView[]>([]);

  async function loadInstances(): Promise<void> {
    const { instances: rows } = await api.get<{ instances: Array<Omit<InstanceView, "sessions">> }>("/api/instances");
    instances.value = rows.map((r) => ({ ...r, sessions: byId(r.id)?.sessions ?? [] }));
  }

  async function loadSessions(instanceId: string): Promise<void> {
    const { sessions } = await api.rpc<{ sessions: SessionDto[] }>(instanceId, "control.sessions.list");
    const inst = byId(instanceId);
    if (inst) inst.sessions = sessions;
  }

  async function createSession(instanceId: string, alias: string, agent: string, workspace: string): Promise<void> {
    await api.rpc(instanceId, "control.sessions.create", { alias, agent, workspace });
    await loadSessions(instanceId);
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
      void loadSessions(event.instanceId);
    }
  }

  function byId(id: string): InstanceView | undefined {
    return instances.value.find((i) => i.id === id);
  }

  return { instances, loadInstances, loadSessions, createSession, removeSession, applyEvent };
});
