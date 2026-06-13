<script setup lang="ts">
import { computed, onMounted, ref } from "vue";
import { useInstancesStore } from "../stores/instances";

const props = defineProps<{ instanceId: string; instanceName: string }>();
const emit = defineEmits<{ close: []; created: [alias: string] }>();

const store = useInstancesStore();
const inst = computed(() => store.byId(props.instanceId));
const agents = computed(() => inst.value?.agents ?? []);
const workspaces = computed(() => inst.value?.workspaces ?? []);

const NEW_WS = "__new__";
const loading = ref(true);
const submitting = ref(false);
const error = ref("");

const alias = ref("");
const agent = ref("");
const workspaceSel = ref("");
const newWsName = ref("");
const newWsPath = ref("");
const newWsDesc = ref("");

const isNewWs = computed(() => workspaceSel.value === NEW_WS);

onMounted(async () => {
  try {
    await store.loadFormOptions(props.instanceId);
    if (agents.value.length) agent.value = agents.value[0].name;
    workspaceSel.value = workspaces.value.length ? workspaces.value[0].name : NEW_WS;
  } catch (e) {
    error.value = e instanceof Error ? e.message : "failed to load options";
  } finally {
    loading.value = false;
  }
});

const canSubmit = computed(() => {
  if (submitting.value || loading.value) return false;
  if (!alias.value.trim() || !agent.value) return false;
  if (isNewWs.value) return Boolean(newWsName.value.trim() && newWsPath.value.trim());
  return Boolean(workspaceSel.value);
});

async function submit(): Promise<void> {
  if (!canSubmit.value) return;
  error.value = "";
  submitting.value = true;
  try {
    let workspace = workspaceSel.value;
    if (isNewWs.value) {
      const ws = await store.createWorkspace(
        props.instanceId,
        newWsName.value.trim(),
        newWsPath.value.trim(),
        newWsDesc.value.trim() || undefined,
      );
      workspace = ws.name;
    }
    await store.createSession(props.instanceId, alias.value.trim(), agent.value, workspace);
    emit("created", alias.value.trim());
    emit("close");
  } catch (e) {
    error.value = e instanceof Error ? e.message : "create failed";
  } finally {
    submitting.value = false;
  }
}
</script>

<template>
  <div class="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" @click.self="emit('close')">
    <div class="w-full max-w-md rounded-xl bg-white shadow-xl" data-test="new-session-dialog">
      <header class="flex items-center justify-between border-b px-5 py-3">
        <h2 class="text-sm font-semibold">New session <span class="font-normal text-slate-400">· {{ instanceName }}</span></h2>
        <button class="rounded p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-600" aria-label="Close" @click="emit('close')">✕</button>
      </header>

      <div class="space-y-4 px-5 py-4">
        <div v-if="loading" class="py-6 text-center text-sm text-slate-400">Loading options…</div>
        <template v-else>
          <label class="block">
            <span class="mb-1 block text-xs font-medium text-slate-600">Session alias</span>
            <input v-model="alias" data-test="ns-alias" placeholder="e.g. backend"
                   class="w-full rounded-lg border px-3 py-2 text-sm focus:border-slate-400 focus:outline-none"
                   @keydown.enter="submit" />
          </label>

          <label class="block">
            <span class="mb-1 block text-xs font-medium text-slate-600">Agent</span>
            <select v-if="agents.length" v-model="agent" data-test="ns-agent"
                    class="w-full rounded-lg border bg-white px-3 py-2 text-sm focus:border-slate-400 focus:outline-none">
              <option v-for="a in agents" :key="a.name" :value="a.name">{{ a.name }} · {{ a.driver }}</option>
            </select>
            <p v-else class="rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-700">No agents configured on this instance.</p>
          </label>

          <label class="block">
            <span class="mb-1 block text-xs font-medium text-slate-600">Workspace</span>
            <select v-model="workspaceSel" data-test="ns-workspace"
                    class="w-full rounded-lg border bg-white px-3 py-2 text-sm focus:border-slate-400 focus:outline-none">
              <option v-for="w in workspaces" :key="w.name" :value="w.name">{{ w.name }} — {{ w.cwd }}</option>
              <option :value="NEW_WS">+ New workspace…</option>
            </select>
          </label>

          <div v-if="isNewWs" data-test="ns-new-ws" class="space-y-2 rounded-lg border border-dashed bg-slate-50 p-3">
            <input v-model="newWsName" data-test="ns-ws-name" placeholder="workspace name (e.g. backend)"
                   class="w-full rounded border px-2 py-1.5 text-sm" />
            <input v-model="newWsPath" data-test="ns-ws-path" placeholder="absolute path (e.g. /Users/me/projects/backend)"
                   class="w-full rounded border px-2 py-1.5 text-sm" />
            <input v-model="newWsDesc" data-test="ns-ws-desc" placeholder="description (optional)"
                   class="w-full rounded border px-2 py-1.5 text-sm" />
          </div>

          <p v-if="error" data-test="ns-error" class="rounded-lg bg-red-50 px-3 py-2 text-xs text-red-700">{{ error }}</p>
        </template>
      </div>

      <footer class="flex justify-end gap-2 border-t px-5 py-3">
        <button class="rounded-lg px-3 py-1.5 text-sm text-slate-600 hover:bg-slate-100" @click="emit('close')">Cancel</button>
        <button data-test="ns-create" :disabled="!canSubmit"
                class="rounded-lg bg-slate-800 px-4 py-1.5 text-sm font-medium text-white enabled:hover:bg-slate-700 disabled:opacity-40"
                @click="submit">{{ submitting ? "Creating…" : "Create" }}</button>
      </footer>
    </div>
  </div>
</template>
