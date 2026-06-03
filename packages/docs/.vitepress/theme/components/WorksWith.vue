<script setup lang="ts">
// "Works with" strip below the hero — xacpx's social-proof analog to Vite's
// trusted-by logo wall. Agents it drives + channels it runs in.
import { computed } from 'vue';
import { useData } from 'vitepress';

const { lang } = useData();
const zh = computed(() => lang.value.startsWith('zh'));

const agents = ['Codex', 'Claude Code', 'Gemini', 'OpenCode'];
const channels = computed(() => (zh.value ? ['微信', '飞书', '元宝'] : ['WeChat', 'Feishu', 'Yuanbao']));
</script>

<template>
  <div class="works-with">
    <div class="ww-row">
      <span class="ww-label">{{ zh ? '驱动这些 Agent' : 'Works with' }}</span>
      <span class="ww-chips">
        <span v-for="a in agents" :key="a" class="ww-chip">{{ a }}</span>
      </span>
    </div>
    <div class="ww-row">
      <span class="ww-label">{{ zh ? '运行在这些频道' : 'Runs in' }}</span>
      <span class="ww-chips">
        <span v-for="c in channels" :key="c" class="ww-chip ww-chip-green">{{ c }}</span>
      </span>
    </div>
  </div>
</template>
