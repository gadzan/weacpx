<script setup lang="ts">
import { computed } from "vue";
import { renderMarkdown } from "../lib/render-markdown";

const props = defineProps<{ text: string; streaming?: boolean }>();
const html = computed(() => renderMarkdown(props.text, { streaming: props.streaming }));
</script>

<template>
  <!-- eslint-disable-next-line vue/no-v-html -- input is sanitized by renderMarkdown (DOMPurify) -->
  <div class="stream-md text-sm" v-html="html" />
</template>

<style>
/* Tailwind's preflight strips element styling, so restore the markdown basics for
   v-html content. Non-scoped on purpose: scoped styles cannot reach v-html output. */
.stream-md > :first-child {
  margin-top: 0;
}
.stream-md > :last-child {
  margin-bottom: 0;
}
.stream-md p {
  margin: 0.5em 0;
  line-height: 1.5;
}
.stream-md h1,
.stream-md h2,
.stream-md h3,
.stream-md h4 {
  margin: 0.8em 0 0.4em;
  font-weight: 600;
  line-height: 1.3;
}
.stream-md h1 {
  font-size: 1.3em;
}
.stream-md h2 {
  font-size: 1.2em;
}
.stream-md h3 {
  font-size: 1.1em;
}
.stream-md ul,
.stream-md ol {
  margin: 0.5em 0;
  padding-left: 1.4em;
}
.stream-md ul {
  list-style: disc;
}
.stream-md ol {
  list-style: decimal;
}
.stream-md li {
  margin: 0.2em 0;
}
.stream-md a {
  color: #2563eb;
  text-decoration: underline;
}
.stream-md code {
  background: rgba(15, 23, 42, 0.08);
  border-radius: 4px;
  padding: 0.1em 0.3em;
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
  font-size: 0.9em;
}
.stream-md pre {
  background: #0f172a;
  color: #e2e8f0;
  border-radius: 8px;
  padding: 0.7em 0.9em;
  overflow-x: auto;
  margin: 0.6em 0;
}
.stream-md pre code {
  background: transparent;
  padding: 0;
  color: inherit;
  font-size: 0.85em;
}
.stream-md blockquote {
  border-left: 3px solid rgba(15, 23, 42, 0.2);
  margin: 0.6em 0;
  padding-left: 0.8em;
  color: rgba(15, 23, 42, 0.7);
}
.stream-md table {
  border-collapse: collapse;
  margin: 0.6em 0;
}
.stream-md th,
.stream-md td {
  border: 1px solid rgba(15, 23, 42, 0.2);
  padding: 0.3em 0.6em;
}
.stream-md hr {
  border: none;
  border-top: 1px solid rgba(15, 23, 42, 0.15);
  margin: 0.8em 0;
}
</style>
