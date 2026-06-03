<script setup lang="ts">
// Phone mockup beside the hero. Renders the real screenshot when present,
// otherwise a placeholder telling the maintainer where to drop it.
import { ref, computed } from 'vue';
import { useData, withBase } from 'vitepress';

const { lang } = useData();
const zh = computed(() => lang.value.startsWith('zh'));
const src = withBase('/mockups/chat-hero.png');
const failed = ref(false);
</script>

<template>
  <div class="chat-mockup">
    <div class="phone">
      <div class="phone-notch" />
      <img
        v-show="!failed"
        :src="src"
        class="phone-shot"
        :alt="zh ? '在聊天中操控 agent 的真机截图' : 'Controlling an agent from a chat thread'"
        @error="failed = true"
      />
      <div v-if="failed" class="phone-placeholder">
        <div class="ph-badge">{{ zh ? '截图占位' : 'Screenshot' }}</div>
        <p class="ph-title">{{ zh ? '真机聊天截图' : 'Real chat screenshot' }}</p>
        <p class="ph-path"><code>public/mockups/chat-hero.png</code></p>
        <p class="ph-hint">
          {{ zh ? '放入该文件后自动显示' : 'Drop the file here — it appears automatically' }}
        </p>
      </div>
    </div>
  </div>
</template>
