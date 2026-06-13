import { defineStore } from "pinia";
import { computed, ref } from "vue";
import type { MessageRecordDto, WebServerEvent } from "@ganglion/xacpx-relay-protocol";
import { api, ApiError } from "../api/client";

export const useChatStore = defineStore("chat", () => {
  const instanceId = ref<string | null>(null);
  const sessionAlias = ref<string | null>(null);
  const messages = ref<MessageRecordDto[]>([]);
  const streamBuffers = ref<Record<string, string>>({});
  const bufKey = (instanceId: string, alias: string) => `${instanceId}\0${alias}`;
  const streaming = computed(() => {
    if (!instanceId.value || !sessionAlias.value) return "";
    return streamBuffers.value[bufKey(instanceId.value, sessionAlias.value)] ?? "";
  });
  const sending = ref(false);
  const error = ref("");

  function select(id: string, alias: string): void {
    instanceId.value = id;
    sessionAlias.value = alias;
    messages.value = [];
  }

  async function loadHistory(): Promise<void> {
    if (!instanceId.value || !sessionAlias.value) return;
    const { messages: rows } = await api.get<{ messages: MessageRecordDto[] }>(
      `/api/instances/${instanceId.value}/sessions/${sessionAlias.value}/messages`,
    );
    messages.value = rows;
  }

  function applyEvent(event: WebServerEvent): void {
    if (event.kind === "instance-status" && !event.online) {
      const prefix = `${event.instanceId}\0`;
      for (const k of Object.keys(streamBuffers.value)) {
        if (k.startsWith(prefix)) delete streamBuffers.value[k];
      }
      return;
    }
    if (event.kind !== "control-event") return;
    const e = event.event;
    if (e.type === "turn-output") {
      const k = bufKey(event.instanceId, e.sessionAlias);
      streamBuffers.value[k] = (streamBuffers.value[k] ?? "") + e.chunk;
    } else if (e.type === "turn-finished") {
      const k = bufKey(event.instanceId, e.sessionAlias);
      const text = streamBuffers.value[k];
      delete streamBuffers.value[k];
      if (text && event.instanceId === instanceId.value && e.sessionAlias === sessionAlias.value) {
        messages.value.push({ instanceId: event.instanceId, sessionAlias: e.sessionAlias, direction: "out", text, createdAt: new Date().toISOString() });
      }
    }
  }

  async function send(text: string): Promise<void> {
    if (!instanceId.value || !sessionAlias.value) return;
    error.value = "";
    sending.value = true;
    messages.value.push({ instanceId: instanceId.value, sessionAlias: sessionAlias.value, direction: "in", text, createdAt: new Date().toISOString() });
    try {
      if (text.startsWith("/")) {
        const { output } = await api.rpc<{ output: string }>(instanceId.value, "control.command.execute", { sessionAlias: sessionAlias.value, text });
        messages.value.push({ instanceId: instanceId.value, sessionAlias: sessionAlias.value, direction: "out", text: output, createdAt: new Date().toISOString() });
      } else {
        await api.rpc(instanceId.value, "control.prompt", { sessionAlias: sessionAlias.value, text });
      }
    } catch (e) {
      error.value = e instanceof ApiError ? e.code : "send-failed";
    } finally {
      sending.value = false;
    }
  }

  return { instanceId, sessionAlias, messages, streaming, sending, error, select, loadHistory, applyEvent, send };
});
