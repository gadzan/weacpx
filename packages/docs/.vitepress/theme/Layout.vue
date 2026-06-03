<script setup lang="ts">
// Home layout: default VitePress theme + Vite-style hero additions.
// - Install command block under the hero CTAs (home-hero-actions-after)
// - Chat mockup beside the hero text (home-hero-image)
// - "Works with" logo strip below the hero (home-hero-after)
import DefaultTheme from 'vitepress/theme';
import InstallCommand from './components/InstallCommand.vue';
import ChatMockup from './components/ChatMockup.vue';
import WorksWith from './components/WorksWith.vue';

const { Layout } = DefaultTheme;
</script>

<template>
  <Layout>
    <template #home-hero-actions-after>
      <InstallCommand />
    </template>
    <template #home-hero-image>
      <ChatMockup />
    </template>
    <template #home-hero-after>
      <WorksWith />
    </template>
  </Layout>
</template>
