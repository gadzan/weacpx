<script setup lang="ts">
// Home layout: default VitePress theme + Vite-style hero additions.
// - Eyebrow label above the headline (home-hero-info-before)
// - Install command block under the hero CTAs (home-hero-actions-after)
// - Chat mockup beside the hero text (home-hero-image)
// - "Works with" logo strip below the hero (home-hero-after)
import { computed } from 'vue';
import DefaultTheme from 'vitepress/theme';
import { useData } from 'vitepress';
import InstallCommand from './components/InstallCommand.vue';
import ChatMockup from './components/ChatMockup.vue';
import WorksWith from './components/WorksWith.vue';
import ChatDemoSection from './components/ChatDemoSection.vue';
import ArchitectureSection from './components/ArchitectureSection.vue';
import CapabilitiesSection from './components/CapabilitiesSection.vue';

const { Layout } = DefaultTheme;
const { lang } = useData();
const zh = computed(() => lang.value.startsWith('zh'));
</script>

<template>
  <Layout>
    <template #home-hero-info-before>
      <p class="hero-eyebrow">
        <span class="hero-eyebrow-dot" />
        {{ zh ? '开源 · 驱动任意 Agent' : 'Open source · Drive any agent' }}
      </p>
    </template>
    <template #home-hero-actions-after>
      <InstallCommand />
    </template>
    <template #home-hero-image>
      <ChatMockup />
    </template>
    <template #home-hero-after>
      <WorksWith />
    </template>
    <template #home-features-before>
      <ChatDemoSection />
    </template>
    <template #home-features-after>
      <ArchitectureSection />
      <CapabilitiesSection />
    </template>
  </Layout>
</template>
