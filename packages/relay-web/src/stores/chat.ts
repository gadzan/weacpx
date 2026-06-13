import { defineStore } from "pinia";
import { ref } from "vue";
import type { MessageRecordDto, WebServerEvent } from "@ganglion/xacpx-relay-protocol";
import { api, ApiError } from "../api/client";

export const useChatStore = defineStore("chat", () => {
  const instanceId = ref<string | null>(null);
  const sessionAlias = ref<string | null>(null);
  const messages = ref<MessageRecordDto[]>([]);
  const streaming = ref("");
  const sending = ref(false);
  const error = ref("");

  function select(id: string, alias: string): void {
    instanceId.value = id;
    sessionAlias.value = alias;
    messages.value = [];
    streaming.value = "";
  }

  async function loadHistory(): Promise<void> {
    if (!instanceId.value || !sessionAlias.value) return;
    const { messages: rows } = await api.get<{ messages: MessageRecordDto[] }>(
      `/api/instances/${instanceId.value}/sessions/${sessionAlias.value}/messages`,
    );
    messages.value = rows;
  }

  function applyEvent(event: WebServerEvent): void {
    if (event.kind !== "control-event") return;
    const e = event.event;
    if (event.instanceId !== instanceId.value) return;
    if (e.type === "turn-output" && e.sessionAlias === sessionAlias.value) {
      streaming.value += e.chunk;
    } else if (e.type === "turn-finished" && e.sessionAlias === sessionAlias.value) {
      if (streaming.value) {
        messages.value.push({ instanceId: event.instanceId, sessionAlias: e.sessionAlias, direction: "out", text: streaming.value, createdAt: new Date().toISOString() });
      }
      streaming.value = "";
    }
  }

  async function send(text: string): Promise<void> {
    if (!instanceId.value || !sessionAlias.value) return;
    error.value = "";
    sending.value = true;
    messages.value.push({ instanceId: instanceId.value, sessionAlias: sessionAlias.value, direction: "in", text, createdAt: new Date().toISOString() });
    try {
      if (text.startsWith("/")) {
        const { output } = await api.rpc<{ output: string }>(instanceId.value, "control.command.execute", { text });
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
