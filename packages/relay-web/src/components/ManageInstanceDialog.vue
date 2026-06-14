<script setup lang="ts">
import { onMounted, ref } from "vue";
import { useInstancesStore } from "../stores/instances";
import WorkspacesManager from "./WorkspacesManager.vue";
import AgentsManager from "./AgentsManager.vue";

const props = defineProps<{ instanceId: string; instanceName: string }>();
const emit = defineEmits<{ close: [] }>();
const store = useInstancesStore();

const loading = ref(true);

onMounted(async () => {
  try {
    await store.loadFormOptions(props.instanceId);
  } catch {
    // best-effort: managers degrade to empty lists if options fail to load
  } finally {
    loading.value = false;
  }
});
</script>

<template>
  <div class="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" @click.self="emit('close')">
    <div class="max-h-[85vh] w-full max-w-xl overflow-y-auto rounded-xl bg-white shadow-xl" data-test="manage-instance-dialog">
      <header class="flex items-center justify-between border-b px-5 py-3">
        <h2 class="text-sm font-semibold">Manage · {{ instanceName }}</h2>
        <button class="text-slate-400 hover:text-slate-600" aria-label="Close" @click="emit('close')">✕</button>
      </header>
      <div v-if="loading" class="py-6 text-center text-sm text-slate-400">Loading…</div>
      <div v-else class="space-y-6 p-5">
        <WorkspacesManager :instance-id="instanceId" />
        <AgentsManager :instance-id="instanceId" />
      </div>
    </div>
  </div>
</template>
