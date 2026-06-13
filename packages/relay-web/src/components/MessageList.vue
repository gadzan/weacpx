<script setup lang="ts">
import type { ChatMessage } from "../stores/chat";
import StreamMarkdown from "./StreamMarkdown.vue";
defineProps<{ messages: ChatMessage[]; streaming: string }>();
</script>

<template>
  <div class="flex-1 space-y-2 overflow-y-auto p-4">
    <div v-for="(m, i) in messages" :key="i" class="flex" :class="m.direction === 'in' ? 'justify-end' : 'justify-start'">
      <!-- User input stays plain text; agent output renders sanitized markdown. -->
      <pre v-if="m.direction === 'in'" data-test="msg-in"
           class="max-w-[80%] whitespace-pre-wrap rounded-lg bg-slate-800 px-3 py-2 text-sm text-white"
           :class="m.failed ? 'ring-1 ring-red-400' : ''">{{ m.text }}<span v-if="m.failed" data-test="msg-failed" class="ml-2 text-xs text-red-400">failed</span></pre>
      <div v-else data-test="msg-out"
           class="max-w-[80%] rounded-lg bg-slate-100 px-3 py-2"
           :class="m.failed ? 'ring-1 ring-red-400' : ''">
        <StreamMarkdown :text="m.text" />
        <span v-if="m.failed" data-test="msg-failed" class="text-xs text-red-400">failed</span>
      </div>
    </div>
    <div v-if="streaming" class="flex justify-start">
      <div data-test="msg-streaming" class="max-w-[80%] rounded-lg bg-slate-100 px-3 py-2 opacity-70">
        <StreamMarkdown :text="streaming" :streaming="true" />
      </div>
    </div>
  </div>
</template>
