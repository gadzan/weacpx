<script setup lang="ts">
import { onMounted, onUnmounted } from "vue";
import { connectEvents } from "../api/events";
import { useInstancesStore } from "../stores/instances";
import { useChatStore } from "../stores/chat";
import InstanceTree from "../components/InstanceTree.vue";
import ChatPane from "../components/ChatPane.vue";

const instances = useInstancesStore();
const chat = useChatStore();
let disconnect: (() => void) | null = null;

function onSelect(instanceId: string, alias: string) {
  chat.select(instanceId, alias);
  void chat.loadHistory();
}

onMounted(async () => {
  await instances.loadInstances();
  disconnect = connectEvents((event) => {
    instances.applyEvent(event);
    chat.applyEvent(event);
  });
});

onUnmounted(() => disconnect?.());
</script>

<template>
  <div class="flex h-screen">
    <div data-test="column" class="w-72 shrink-0">
      <InstanceTree @select="onSelect" />
    </div>
    <div data-test="column" class="flex flex-1 flex-col">
      <ChatPane />
    </div>
    <div data-test="column" class="hidden w-72 shrink-0 border-l bg-white lg:block">
      <div class="p-4 text-sm text-slate-400">Tasks panel — phase 4</div>
    </div>
  </div>
</template>
