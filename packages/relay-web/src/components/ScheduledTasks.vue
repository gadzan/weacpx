<script setup lang="ts">
import { ref } from "vue";
import { useTasksStore } from "../stores/tasks";
import { useChatStore } from "../stores/chat";

const tasks = useTasksStore();
const chat = useChatStore();
const executeAt = ref("");
const message = ref("");

async function create() {
  if (!chat.instanceId || !chat.sessionAlias || !executeAt.value || !message.value) return;
  const iso = new Date(executeAt.value).toISOString();
  await tasks.createScheduled(chat.instanceId, chat.sessionAlias, iso, message.value);
  executeAt.value = "";
  message.value = "";
}
</script>

<template>
  <div class="border-b p-3">
    <h3 class="mb-2 text-xs font-semibold uppercase text-slate-500">Scheduled</h3>
    <ul class="space-y-1">
      <li v-for="t in tasks.scheduled" :key="t.id" class="flex items-center justify-between text-sm">
        <span class="truncate"><span class="text-slate-400">{{ new Date(t.executeAt).toLocaleString() }}</span> {{ t.message }}</span>
        <button data-test="cancel-scheduled" class="ml-2 text-xs text-red-500 hover:underline" @click="tasks.cancelScheduled(t.id)">cancel</button>
      </li>
      <li v-if="tasks.scheduled.length === 0" class="text-xs text-slate-400">No scheduled tasks.</li>
    </ul>
    <form class="mt-2 space-y-1" @submit.prevent="create">
      <input v-model="executeAt" type="datetime-local" class="w-full rounded border px-1 py-0.5 text-xs" />
      <input v-model="message" placeholder="message" class="w-full rounded border px-1 py-0.5 text-xs" />
      <button type="submit" class="w-full rounded bg-slate-700 px-2 py-1 text-xs text-white">Schedule</button>
    </form>
  </div>
</template>
