<script setup lang="ts">
import { ref } from "vue";
import type { ToolStepDto } from "@ganglion/xacpx-relay-protocol";
import ToolDetail from "./ToolDetail.vue";

defineProps<{ steps: ToolStepDto[] }>();

const open = ref(true);
const expanded = ref<Set<string>>(new Set());
function toggleRow(id: string) {
  if (expanded.value.has(id)) expanded.value.delete(id); else expanded.value.add(id);
  expanded.value = new Set(expanded.value);
}

const STATUS_ICON: Record<string, string> = { running: "⏳", success: "✅", error: "❌" };
const KIND_ICON: Record<string, string> = { read: "📖", search: "🔍", execute: "💻", edit: "✏️", think: "🧠", other: "🔧" };
function fmtDuration(ms?: number): string {
  if (ms === undefined) return "";
  return ms >= 1000 ? `${(ms / 1000).toFixed(1)}s` : `${ms}ms`;
}
</script>

<template>
  <div class="mt-1 rounded border border-slate-200 text-xs">
    <button type="button" class="flex w-full items-center gap-1 px-2 py-1 text-left text-slate-600" @click="open = !open">
      <span>{{ open ? "▾" : "▸" }}</span>
      <span>🔧 Tool calls</span>
      <span data-test="tool-count" class="text-slate-400">({{ steps.length }})</span>
    </button>
    <ul v-if="open" class="divide-y divide-slate-100">
      <li v-for="s in steps" :key="s.toolCallId">
        <button type="button" data-test="tool-row" class="flex w-full items-center gap-2 px-2 py-1 text-left hover:bg-slate-50" @click="toggleRow(s.toolCallId)">
          <span>{{ STATUS_ICON[s.status] }}</span>
          <span>{{ KIND_ICON[s.kind] }}</span>
          <span class="truncate font-mono text-slate-700">{{ s.title }}</span>
          <span v-if="s.durationMs !== undefined" class="ml-auto text-slate-400">{{ fmtDuration(s.durationMs) }}</span>
        </button>
        <div v-if="expanded.has(s.toolCallId) && s.detail" class="px-2 pb-2">
          <ToolDetail :detail="s.detail" />
        </div>
      </li>
    </ul>
  </div>
</template>
