<script setup lang="ts">
import { computed, ref } from "vue";
import { useInstancesStore } from "../stores/instances";

const props = defineProps<{ instanceId: string }>();
const store = useInstancesStore();
const inst = computed(() => store.byId(props.instanceId));

const name = ref("");
const path = ref("");
const description = ref("");
const error = ref("");
const busy = ref(false);

async function create(): Promise<void> {
  if (!name.value.trim() || !path.value.trim() || busy.value) return;
  busy.value = true; error.value = "";
  try {
    await store.createWorkspace(props.instanceId, name.value.trim(), path.value.trim(), description.value.trim() || undefined);
    name.value = ""; path.value = ""; description.value = "";
  } catch (e) { error.value = e instanceof Error ? e.message : "create failed"; }
  finally { busy.value = false; }
}

async function remove(wsName: string): Promise<void> {
  error.value = "";
  try { await store.removeWorkspace(props.instanceId, wsName); }
  catch (e) { error.value = e instanceof Error ? e.message : "remove failed"; }
}
</script>

<template>
  <section class="space-y-3">
    <h3 class="text-sm font-semibold uppercase text-slate-500">Workspaces</h3>
    <p v-if="error" data-test="wm-error" class="rounded bg-red-50 px-3 py-2 text-sm text-red-700">{{ error }}</p>
    <ul class="divide-y rounded border">
      <li v-for="w in inst?.workspaces ?? []" :key="w.name" class="flex items-center justify-between px-3 py-2 text-sm">
        <span><span class="font-medium">{{ w.name }}</span> — <span class="text-slate-500">{{ w.cwd }}</span></span>
        <button :data-test="`wm-remove-${w.name}`" class="text-red-600 hover:underline" @click="remove(w.name)">remove</button>
      </li>
    </ul>
    <div class="grid grid-cols-1 gap-2 sm:grid-cols-3">
      <input v-model="name" data-test="wm-name" placeholder="name" class="rounded border px-2 py-1 text-sm" />
      <input v-model="path" data-test="wm-path" placeholder="/abs/path" class="rounded border px-2 py-1 text-sm" />
      <input v-model="description" data-test="wm-desc" placeholder="description (optional)" class="rounded border px-2 py-1 text-sm" />
    </div>
    <button data-test="wm-create" class="rounded bg-slate-800 px-3 py-1.5 text-sm text-white disabled:opacity-50"
            :disabled="busy || !name.trim() || !path.trim()" @click="create">Add workspace</button>
  </section>
</template>
