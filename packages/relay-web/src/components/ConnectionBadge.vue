<script setup lang="ts">
import { useConnectionStore } from "../stores/connection";
const conn = useConnectionStore();
</script>

<template>
  <div v-if="!conn.online" data-test="conn-badge" class="bg-amber-100 px-3 py-1 text-center text-xs text-amber-800">
    Reconnecting…
  </div>
</template>
