// Custom theme: default VitePress theme + xacpx home page (Vite-style hero).
import DefaultTheme from 'vitepress/theme';
import Layout from './Layout.vue';
import './style.css';

export default {
  extends: DefaultTheme,
  Layout,
};
