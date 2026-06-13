<script setup lang="ts">
import { useInstancesStore } from "../stores/instances";

const store = useInstancesStore();
const emit = defineEmits<{ select: [instanceId: string, alias: string] }>();

async function toggle(id: string) {
  await store.loadSessions(id);
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
        <li v-for="s in inst.sessions" :key="s.alias">
          <button class="flex w-full items-center gap-2 px-6 py-1 text-left text-sm hover:bg-slate-50"
                  @click="emit('select', inst.id, s.alias)">
            <span v-if="s.running" class="text-amber-500">●</span>
            {{ s.alias }} <span class="text-slate-400">({{ s.agent }})</span>
          </button>
        </li>
      </ul>
    </div>
  </div>
</template>
