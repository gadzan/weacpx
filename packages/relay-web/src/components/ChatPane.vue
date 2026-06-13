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
      <div v-if="chat.error" data-test="chat-error" class="bg-red-50 px-4 py-1 text-xs text-red-700">
        {{ chat.error }}
        <button class="ml-2 underline" @click="chat.error = ''">dismiss</button>
      </div>
      <MessageList :messages="chat.messages" :streaming="chat.streaming" />
      <div v-if="chat.sending || chat.streaming" class="px-4 pb-1">
        <button data-test="cancel-turn" class="text-xs text-red-500 hover:underline" @click="chat.cancel">Cancel</button>
      </div>
      <PromptInput @send="chat.send" />
    </template>
  </div>
</template>
