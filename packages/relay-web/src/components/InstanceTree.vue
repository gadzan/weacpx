<script setup lang="ts">
import { reactive, ref } from "vue";
import { useInstancesStore } from "../stores/instances";

const store = useInstancesStore();
const emit = defineEmits<{ select: [instanceId: string, alias: string] }>();
const formFor = ref<string | null>(null);
const draft = reactive({ alias: "", agent: "", workspace: "" });

async function toggle(id: string) {
  await store.loadSessions(id).catch(() => {});
}
function openForm(id: string) {
  formFor.value = formFor.value === id ? null : id;
  draft.alias = "";
  draft.agent = "";
  draft.workspace = "";
}
async function submitNew(id: string) {
  if (!draft.alias || !draft.agent || !draft.workspace) return;
  await store.createSession(id, draft.alias, draft.agent, draft.workspace).catch(() => {});
  formFor.value = null;
}
function remove(id: string, alias: string) {
  void store.removeSession(id, alias).catch(() => {});
}
</script>

<template>
  <div class="flex h-full flex-col overflow-y-auto border-r bg-white">
    <div v-for="inst in store.instances" :key="inst.id" class="border-b">
      <button class="flex w-full items-center gap-2 px-3 py-2 text-left" @click="toggle(inst.id)">
        <span class="h-2 w-2 rounded-full" :class="inst.online ? 'bg-green-500' : 'bg-slate-300'" data-test="online-dot" />
        <span class="font-medium">{{ inst.name }}</span>
      </button>
      <ul>
        <li v-for="s in inst.sessions" :key="s.alias" class="flex items-center justify-between pr-2">
          <button class="flex flex-1 items-center gap-2 px-6 py-1 text-left text-sm hover:bg-slate-50"
                  @click="emit('select', inst.id, s.alias)">
            <span v-if="s.running" class="text-amber-500">●</span>
            {{ s.alias }} <span class="text-slate-400">({{ s.agent }})</span>
          </button>
          <button data-test="delete-session" class="text-xs text-red-400 hover:underline" @click.stop="remove(inst.id, s.alias)">delete</button>
        </li>
      </ul>
      <button data-test="new-session" class="px-6 py-1 text-left text-xs text-slate-500 hover:underline" @click="openForm(inst.id)">+ new session</button>
      <form v-if="formFor === inst.id" class="space-y-1 px-6 py-1" @submit.prevent="submitNew(inst.id)">
        <input v-model="draft.alias" data-test="new-session-alias" placeholder="alias" class="w-full rounded border px-1 text-xs" />
        <input v-model="draft.agent" data-test="new-session-agent" placeholder="agent" class="w-full rounded border px-1 text-xs" />
        <input v-model="draft.workspace" data-test="new-session-workspace" placeholder="workspace" class="w-full rounded border px-1 text-xs" />
        <button type="submit" data-test="new-session-submit" class="w-full rounded bg-slate-700 px-2 py-0.5 text-xs text-white">Create</button>
      </form>
    </div>
  </div>
</template>
