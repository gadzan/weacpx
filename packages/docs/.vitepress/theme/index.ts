// Custom theme: default VitePress theme + xacpx home (Linear craft x field.io motion).
import DefaultTheme from 'vitepress/theme';
import type { App } from 'vue';
import Layout from './Layout.vue';
import './style.css';

// Global `v-reveal` directive: scroll-triggered staggered entrance.
// Pass an index for stagger, e.g. v-reveal="2". Honors reduced-motion.
// Registered on both server and client so SSR can resolve it; all DOM work
// is client-only (mounted never runs during SSR).
function registerReveal(app: App) {
  const isClient = typeof window !== 'undefined';
  const reduced =
    isClient && (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false);

  const io = isClient
    ? new IntersectionObserver(
        (entries) => {
          for (const e of entries) {
            if (e.isIntersecting) {
              e.target.classList.add('is-in');
              io!.unobserve(e.target);
            }
          }
        },
        { threshold: 0.12, rootMargin: '0px 0px -7% 0px' },
      )
    : null;

  app.directive('reveal', {
    getSSRProps() {
      return {};
    },
    mounted(el: HTMLElement, binding) {
      el.classList.add('x-reveal');
      if (binding.value != null) el.style.setProperty('--ri', String(binding.value));
      if (reduced) {
        el.classList.add('is-in');
        return;
      }
      io?.observe(el);
    },
    unmounted(el: HTMLElement) {
      io?.unobserve(el);
    },
  });
}

export default {
  extends: DefaultTheme,
  Layout,
  enhanceApp({ app }: { app: App }) {
    registerReveal(app);
  },
};
