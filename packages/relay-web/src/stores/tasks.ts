import { defineStore } from "pinia";
import { ref } from "vue";
import type { OrchestrationTaskDto, ScheduledTaskDto, WebServerEvent } from "@ganglion/xacpx-relay-protocol";
import { api } from "../api/client";

export interface TasksScope {
  instanceId: string;
  sessionAlias: string;
}

export const useTasksStore = defineStore("tasks", () => {
  const scheduled = ref<ScheduledTaskDto[]>([]);
  const orchestration = ref<OrchestrationTaskDto[]>([]);
  const scope = ref<TasksScope | null>(null);

  async function loadScheduled(instanceId: string, sessionAlias: string): Promise<void> {
    const { tasks } = await api.rpc<{ tasks: ScheduledTaskDto[] }>(instanceId, "control.scheduled.list");
    scheduled.value = tasks.filter((t) => t.sessionAlias === sessionAlias);
  }

  async function loadOrchestration(instanceId: string): Promise<void> {
    const { tasks } = await api.rpc<{ tasks: OrchestrationTaskDto[] }>(instanceId, "control.orchestration.list");
    orchestration.value = tasks;
  }

  async function loadFor(instanceId: string, sessionAlias: string): Promise<void> {
    scope.value = { instanceId, sessionAlias };
    await Promise.all([
      loadScheduled(instanceId, sessionAlias).catch(() => { scheduled.value = []; }),
      loadOrchestration(instanceId).catch(() => { orchestration.value = []; }),
    ]);
  }

  async function createScheduled(instanceId: string, sessionAlias: string, executeAt: string, message: string): Promise<void> {
    await api.rpc(instanceId, "control.scheduled.create", { sessionAlias, executeAt, message });
    await loadScheduled(instanceId, sessionAlias);
  }

  async function cancelScheduled(id: string): Promise<void> {
    const s = scope.value;
    if (!s) return;
    await api.rpc(s.instanceId, "control.scheduled.cancel", { id });
    await loadScheduled(s.instanceId, s.sessionAlias);
  }

  async function cancelOrchestration(taskId: string): Promise<void> {
    const s = scope.value;
    if (!s) return;
    await api.rpc(s.instanceId, "control.orchestration.cancel", { taskId });
    await loadOrchestration(s.instanceId);
  }

  function applyEvent(event: WebServerEvent): void {
    if (event.kind !== "control-event") return;
    const s = scope.value;
    if (!s || event.instanceId !== s.instanceId) return;
    if (event.event.type === "scheduled-changed") void loadScheduled(s.instanceId, s.sessionAlias).catch(() => {});
    else if (event.event.type === "orchestration-changed") void loadOrchestration(s.instanceId).catch(() => {});
  }

  return { scheduled, orchestration, scope, loadScheduled, loadOrchestration, loadFor, createScheduled, cancelScheduled, cancelOrchestration, applyEvent };
});
