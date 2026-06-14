<script setup lang="ts">
import { computed, ref } from "vue";
import { useInstancesStore } from "../stores/instances";

const props = defineProps<{ instanceId: string }>();
const store = useInstancesStore();
const inst = computed(() => store.byId(props.instanceId));

const driver = ref("");
const customName = ref("");
const error = ref("");
const busy = ref(false);

const addableDrivers = computed(() => (inst.value?.agentCatalog ?? []).filter((c) => !c.configured));

async function add(): Promise<void> {
  if (!driver.value || busy.value) return;
  busy.value = true; error.value = "";
  try {
    await store.createAgent(props.instanceId, customName.value.trim() || driver.value, driver.value);
    driver.value = ""; customName.value = "";
  } catch (e) { error.value = e instanceof Error ? e.message : "add failed"; }
  finally { busy.value = false; }
}

async function remove(name: string): Promise<void> {
  if (busy.value) return;
  busy.value = true; error.value = "";
  try { await store.removeAgent(props.instanceId, name); }
  catch (e) { error.value = e instanceof Error ? e.message : "remove failed"; }
  finally { busy.value = false; }
}

function hint(installed: string): string {
  return installed === "builtin" ? "built-in" : installed === "yes" ? "installed" : "CLI not detected";
}
</script>

<template>
  <section class="space-y-3">
    <h3 class="text-sm font-semibold uppercase text-slate-500">Agents</h3>
    <p v-if="error" data-test="am-error" class="rounded bg-red-50 px-3 py-2 text-sm text-red-700">{{ error }}</p>
    <p v-if="!(inst?.agents ?? []).length" data-test="am-empty" class="text-sm text-slate-400">No agents yet.</p>
    <ul v-else class="divide-y rounded border">
      <li v-for="a in inst?.agents ?? []" :key="a.name" class="flex items-center justify-between px-3 py-2 text-sm">
        <span><span class="font-medium">{{ a.name }}</span> · <span class="text-slate-500">{{ a.driver }}</span></span>
        <button :data-test="`am-remove-${a.name}`" class="text-red-600 hover:underline disabled:opacity-50" :disabled="busy" @click="remove(a.name)">remove</button>
      </li>
    </ul>
    <div class="grid grid-cols-1 gap-2 sm:grid-cols-3">
      <select v-model="driver" data-test="am-driver" class="rounded border px-2 py-1 text-sm">
        <option value="" disabled>Choose a driver…</option>
        <option v-for="c in addableDrivers" :key="c.driver" :value="c.driver" :disabled="c.installed === 'unknown'">
          {{ c.driver }} ({{ hint(c.installed) }})
        </option>
      </select>
      <input v-model="customName" data-test="am-name" placeholder="name (optional, = driver)" class="rounded border px-2 py-1 text-sm" />
      <button data-test="am-add" class="rounded bg-slate-800 px-3 py-1.5 text-sm text-white disabled:opacity-50"
              :disabled="busy || !driver" @click="add">Add agent</button>
    </div>
  </section>
</template>
