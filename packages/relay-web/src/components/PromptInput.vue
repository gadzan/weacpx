<script setup lang="ts">
import { ref } from "vue";
const props = defineProps<{ busy?: boolean }>();
const emit = defineEmits<{ send: [text: string] }>();
const text = ref("");
function submit() {
  if (props.busy) return;
  const value = text.value.trim();
  if (!value) return;
  emit("send", value);
  text.value = "";
}
</script>

<template>
  <form class="border-t p-3" @submit.prevent="submit">
    <textarea v-model="text" rows="2" :disabled="busy"
              class="w-full resize-none rounded border px-3 py-2 text-sm disabled:bg-slate-100 disabled:text-slate-400"
              :placeholder="busy ? 'Agent is working…' : 'Message, or /command'"
              @keydown.enter.exact.prevent="submit" />
  </form>
</template>
