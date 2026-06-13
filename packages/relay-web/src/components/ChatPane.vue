<script setup lang="ts">
import { useChatStore } from "../stores/chat";
import MessageList from "./MessageList.vue";
import PromptInput from "./PromptInput.vue";

const chat = useChatStore();
</script>

<template>
  <div class="flex h-full flex-1 flex-col">
    <div v-if="!chat.sessionAlias" class="flex flex-1 items-center justify-center text-slate-400">
      Select a session
    </div>
    <template v-else>
      <div class="border-b px-4 py-2 text-sm font-medium">{{ chat.sessionAlias }}</div>
      <MessageList :messages="chat.messages" :streaming="chat.streaming" />
      <PromptInput @send="chat.send" />
    </template>
  </div>
</template>
