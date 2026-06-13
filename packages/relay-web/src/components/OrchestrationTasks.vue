<script setup lang="ts">
import { useTasksStore } from "../stores/tasks";

const tasks = useTasksStore();
</script>

<template>
  <div class="p-3">
    <h3 class="mb-2 text-xs font-semibold uppercase text-slate-500">Orchestration</h3>
    <ul class="space-y-1">
      <li v-for="t in tasks.orchestration" :key="t.taskId" class="flex items-center justify-between text-sm">
        <span class="truncate">{{ t.task }} <span class="text-xs text-slate-400">({{ t.status }})</span></span>
        <button data-test="cancel-orchestration" class="ml-2 text-xs text-red-500 hover:underline" @click="tasks.cancelOrchestration(t.taskId)">cancel</button>
      </li>
      <li v-if="tasks.orchestration.length === 0" class="text-xs text-slate-400">No orchestration tasks.</li>
    </ul>
  </div>
</template>
