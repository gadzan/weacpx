<script setup lang="ts">
import { ref } from "vue";
defineProps<{ reasoning: string }>();
const open = ref(true);
</script>

<template>
  <div class="mt-1 rounded border border-slate-200 text-xs">
    <button type="button" class="flex w-full items-center gap-1 px-2 py-1 text-left text-slate-600" @click="open = !open">
      <span>{{ open ? "▾" : "▸" }}</span>
      <span>🧠 Reasoning</span>
    </button>
    <p v-if="open" data-test="reasoning-body" class="whitespace-pre-wrap px-2 pb-2 text-slate-600">{{ reasoning }}</p>
  </div>
</template>
