<script setup lang="ts">
import type { ChatMessage } from "../stores/chat";
defineProps<{ messages: ChatMessage[]; streaming: string }>();
</script>

<template>
  <div class="flex-1 space-y-2 overflow-y-auto p-4">
    <div v-for="(m, i) in messages" :key="i" class="flex" :class="m.direction === 'in' ? 'justify-end' : 'justify-start'">
      <pre class="max-w-[80%] whitespace-pre-wrap rounded-lg px-3 py-2 text-sm"
           :class="[m.direction === 'in' ? 'bg-slate-800 text-white' : 'bg-slate-100', m.failed ? 'ring-1 ring-red-400' : '']">{{ m.text }}<span v-if="m.failed" data-test="msg-failed" class="ml-2 text-xs text-red-400">failed</span></pre>
    </div>
    <div v-if="streaming" class="flex justify-start">
      <pre class="max-w-[80%] whitespace-pre-wrap rounded-lg bg-slate-100 px-3 py-2 text-sm opacity-70">{{ streaming }}</pre>
    </div>
  </div>
</template>
