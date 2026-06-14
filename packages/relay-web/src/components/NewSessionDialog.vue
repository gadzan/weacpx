<script setup lang="ts">
import { computed, onMounted, ref } from "vue";
import { useInstancesStore } from "../stores/instances";
import { genAlias, uniqueName, workspaceNameFromPath } from "../lib/session-form";

const props = defineProps<{ instanceId: string; instanceName: string }>();
const emit = defineEmits<{ created: [alias: string]; close: [] }>();

const store = useInstancesStore();
const inst = computed(() => store.byId(props.instanceId));

const alias = ref("");
const agentValue = ref("");           // chosen agent NAME or un-configured driver
const wsMode = ref<"existing" | "path">("existing");
const workspaceSel = ref("");
const workspacePath = ref("");
const submitting = ref(false);
const pending = ref(false);
const error = ref("");
const loading = ref(true);

onMounted(async () => {
  try {
    await store.loadFormOptions(props.instanceId);
  } catch (e) {
    error.value = e instanceof Error ? e.message : "failed to load options";
  } finally {
    loading.value = false;
  }
  // default selections
  agentValue.value = inst.value?.agents[0]?.name ?? inst.value?.agentCatalog.find((c) => c.installed !== "unknown")?.driver ?? "";
  workspaceSel.value = inst.value?.workspaces[0]?.name ?? "";
});

// configured agent NAMEs (to know if a chosen value needs agent auto-create)
const configuredNames = computed(() => new Set((inst.value?.agents ?? []).map((a) => a.name)));
// catalog drivers not already configured (shown after configured agents)
const extraDrivers = computed(() =>
  (inst.value?.agentCatalog ?? []).filter((c) => !c.configured),
);

const resolvedWorkspaceName = computed(() =>
  wsMode.value === "path"
    ? (workspacePath.value.trim() ? workspaceNameFromPath(workspacePath.value) : "")
    : workspaceSel.value,
);
const aliasPlaceholder = computed(() =>
  resolvedWorkspaceName.value && agentValue.value ? genAlias(resolvedWorkspaceName.value, agentValue.value) : "auto",
);

const canSubmit = computed(() => {
  if (submitting.value || !agentValue.value) return false;
  if (wsMode.value === "existing") return !!workspaceSel.value;
  return !!workspacePath.value.trim();
});

async function submit(): Promise<void> {
  if (!canSubmit.value) return;
  submitting.value = true;
  error.value = "";
  try {
    const agentName = agentValue.value;
    // 1) auto-create the config agent if an un-configured driver was picked
    if (!configuredNames.value.has(agentName)) {
      await store.createAgent(props.instanceId, agentName, agentName);
    }
    // 2) resolve workspace (auto-create from path if in New-path mode)
    let workspaceName = workspaceSel.value;
    if (wsMode.value === "path") {
      const existing = (inst.value?.workspaces ?? []).map((w) => w.name);
      workspaceName = uniqueName(workspaceNameFromPath(workspacePath.value), existing);
    }
    // 3) alias: explicit, else generated + de-duped against existing sessions
    const existingAliases = (inst.value?.sessions ?? []).map((s) => s.alias);
    const finalAlias = alias.value.trim() || uniqueName(genAlias(workspaceName, agentName), existingAliases);
    // 3b) guard against empty derived names (e.g. an all-symbols path/alias)
    if (!workspaceName || !finalAlias) {
      error.value = "could not derive a valid name — please enter an alias or a normal path";
      return;
    }
    // 4) create the workspace once names are confirmed valid
    if (wsMode.value === "path") {
      await store.createWorkspace(props.instanceId, workspaceName, workspacePath.value.trim());
    }
    // 5) create the session (preserve PR #31 pending handling)
    const result = await store.createSession(props.instanceId, finalAlias, agentName, workspaceName);
    if (result.pending) { pending.value = true; return; }
    emit("created", finalAlias);
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
        <div v-if="pending" data-test="ns-pending" class="rounded-lg bg-blue-50 px-3 py-3 text-xs text-blue-700">
          Session is being created and will appear in the list shortly…
        </div>
        <div v-else-if="loading" class="py-6 text-center text-sm text-slate-400">Loading options…</div>
        <template v-else>
          <label class="block">
            <span class="mb-1 block text-xs font-medium text-slate-600">Session alias <span class="font-normal text-slate-400">(optional)</span></span>
            <input v-model="alias" data-test="ns-alias" :placeholder="aliasPlaceholder"
                   class="w-full rounded-lg border px-3 py-2 text-sm focus:border-slate-400 focus:outline-none"
                   @keydown.enter="submit" />
          </label>

          <label class="block">
            <span class="mb-1 block text-xs font-medium text-slate-600">Agent</span>
            <select v-model="agentValue" data-test="ns-agent"
                    class="w-full rounded-lg border bg-white px-3 py-2 text-sm focus:border-slate-400 focus:outline-none">
              <optgroup v-if="inst?.agents.length" label="Configured">
                <option v-for="a in inst.agents" :key="a.name" :value="a.name">{{ a.name }} · {{ a.driver }}</option>
              </optgroup>
              <optgroup v-if="extraDrivers.length" label="Available drivers">
                <option v-for="c in extraDrivers" :key="c.driver" :value="c.driver" :disabled="c.installed === 'unknown'">
                  {{ c.driver }}{{ c.installed === 'unknown' ? ' — CLI not detected' : '' }}
                </option>
              </optgroup>
            </select>
          </label>

          <div class="block">
            <div class="mb-1 flex items-center justify-between">
              <span class="text-xs font-medium text-slate-600">Workspace</span>
              <div class="flex gap-1">
                <button type="button" data-test="ns-ws-mode-existing"
                        class="rounded px-2 py-0.5 text-xs"
                        :class="wsMode === 'existing' ? 'bg-slate-800 text-white' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'"
                        @click="wsMode = 'existing'">Existing</button>
                <button type="button" data-test="ns-ws-mode-path"
                        class="rounded px-2 py-0.5 text-xs"
                        :class="wsMode === 'path' ? 'bg-slate-800 text-white' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'"
                        @click="wsMode = 'path'">New path</button>
              </div>
            </div>
            <select v-if="wsMode === 'existing'" v-model="workspaceSel" data-test="ns-workspace"
                    class="w-full rounded-lg border bg-white px-3 py-2 text-sm focus:border-slate-400 focus:outline-none">
              <option v-for="w in inst?.workspaces ?? []" :key="w.name" :value="w.name">{{ w.name }} — {{ w.cwd }}</option>
            </select>
            <input v-else v-model="workspacePath" data-test="ns-ws-path" placeholder="/abs/path"
                   class="w-full rounded-lg border px-3 py-2 text-sm focus:border-slate-400 focus:outline-none" />
          </div>

          <p v-if="error" data-test="ns-error" class="rounded-lg bg-red-50 px-3 py-2 text-xs text-red-700">{{ error }}</p>
        </template>
      </div>

      <footer class="flex justify-end gap-2 border-t px-5 py-3">
        <template v-if="pending">
          <button data-test="ns-pending-close"
                  class="rounded-lg bg-slate-800 px-4 py-1.5 text-sm font-medium text-white hover:bg-slate-700"
                  @click="emit('created', alias.trim()); emit('close')">OK</button>
        </template>
        <template v-else>
          <button class="rounded-lg px-3 py-1.5 text-sm text-slate-600 hover:bg-slate-100" @click="emit('close')">Cancel</button>
          <button data-test="ns-create" :disabled="!canSubmit"
                  class="rounded-lg bg-slate-800 px-4 py-1.5 text-sm font-medium text-white enabled:hover:bg-slate-700 disabled:opacity-40"
                  @click="submit">{{ submitting ? "Creating…" : "Create" }}</button>
        </template>
      </footer>
    </div>
  </div>
</template>
