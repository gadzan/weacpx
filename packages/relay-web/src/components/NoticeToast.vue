<script setup lang="ts">
import { useNoticesStore } from "../stores/notices";

const notices = useNoticesStore();
</script>

<template>
  <div class="pointer-events-none fixed bottom-4 right-4 z-50 flex w-72 flex-col gap-2">
    <div
      v-for="n in notices.items.slice(0, 4)"
      :key="n.id"
      data-test="notice"
      class="pointer-events-auto rounded bg-slate-800 px-3 py-2 text-sm text-white shadow"
    >
      <div class="flex items-start justify-between gap-2">
        <span><span class="text-xs uppercase text-slate-400">{{ n.kind }}</span><br />{{ n.text }}</span>
        <button class="text-xs text-slate-400 hover:text-white" @click="notices.dismiss(n.id)">×</button>
      </div>
    </div>
  </div>
</template>
