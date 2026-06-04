<script setup lang="ts">
// "How it works" — animated pipeline diagram. Our analog to Vite's
// Bundle-vs-ESM architecture graphs: a message packet flows
// Chat → Router → Sessions → Transport → acpx → Agent, and a callout
// explains the two-session-layer model (logical vs transport).
import { computed } from 'vue';
import { useData } from 'vitepress';

const { lang } = useData();
const zh = computed(() => lang.value.startsWith('zh'));

interface Node {
  key: string;
  title: string;
  sub: string;
  icon: string;
}

const chatIcon =
  '<path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>';
const routerIcon =
  '<line x1="6" y1="3" x2="6" y2="15"/><circle cx="18" cy="6" r="3"/><circle cx="6" cy="18" r="3"/><path d="M18 9a9 9 0 0 1-9 9"/>';
const sessionsIcon =
  '<polygon points="12 2 2 7 12 12 22 7 12 2"/><polyline points="2 17 12 22 22 17"/><polyline points="2 12 12 17 22 12"/>';
const transportIcon =
  '<path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/>';
const agentIcon =
  '<path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"/><polyline points="3.27 6.96 12 12.01 20.73 6.96"/><line x1="12" y1="22.08" x2="12" y2="12"/>';

const nodes = computed<Node[]>(() =>
  zh.value
    ? [
        { key: 'chat', title: '聊天频道', sub: '微信 · 飞书 · 元宝', icon: chatIcon },
        { key: 'router', title: '路由', sub: '斜杠命令 + 提示词', icon: routerIcon },
        { key: 'sessions', title: '会话映射', sub: '逻辑 ↔ 传输', icon: sessionsIcon },
        { key: 'transport', title: '传输层', sub: 'acpx-cli · acpx-bridge', icon: transportIcon },
        { key: 'agent', title: 'acpx → Agent', sub: 'Codex · Claude Code · Gemini', icon: agentIcon },
      ]
    : [
        { key: 'chat', title: 'Chat channel', sub: 'WeChat · Feishu · Yuanbao', icon: chatIcon },
        { key: 'router', title: 'Router', sub: 'slash commands + prompts', icon: routerIcon },
        { key: 'sessions', title: 'Sessions', sub: 'logical ↔ transport', icon: sessionsIcon },
        { key: 'transport', title: 'Transport', sub: 'acpx-cli · acpx-bridge', icon: transportIcon },
        { key: 'agent', title: 'acpx → Agent', sub: 'Codex · Claude Code · Gemini', icon: agentIcon },
      ],
);
</script>

<template>
  <section class="arch-section">
    <div class="arch-head" v-reveal="0">
      <span class="arch-kicker">{{ zh ? '工作原理' : 'How it works' }}</span>
      <h2 class="arch-title">
        {{ zh ? '一条消息，穿过整条管线' : 'One message, through the whole pipeline' }}
      </h2>
      <p class="arch-sub">
        {{
          zh
            ? 'xacpx 把聊天消息桥接到运行在你机器上的 acpx Agent 会话。'
            : 'xacpx bridges a chat message to an acpx agent session running on your machine.'
        }}
      </p>
    </div>

    <div class="arch-flow" aria-hidden="true" v-reveal="1">
      <template v-for="(n, i) in nodes" :key="n.key">
        <div class="arch-node">
          <span class="arch-icon">
            <svg
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              stroke-width="2"
              stroke-linecap="round"
              stroke-linejoin="round"
              v-html="n.icon"
            />
          </span>
          <p class="arch-node-title">{{ n.title }}</p>
          <p class="arch-node-sub">{{ n.sub }}</p>
        </div>
        <div v-if="i < nodes.length - 1" class="arch-link" :style="{ '--d': i * 0.16 + 's' }">
          <span class="arch-packet" />
        </div>
      </template>
    </div>

    <div class="arch-layers" v-reveal="2">
      <div class="arch-layer">
        <p class="arch-layer-tag">{{ zh ? '逻辑会话' : 'Logical session' }}</p>
        <p class="arch-layer-body">
          {{
            zh
              ? 'xacpx 管理：别名、Agent、工作区、每用户聊天上下文。'
              : 'xacpx-managed: alias, agent, workspace, per-user chat context.'
          }}
        </p>
      </div>
      <div class="arch-maps">
        <span class="arch-maps-line" />
        <span class="arch-maps-label">{{ zh ? '映射到' : 'maps to' }}</span>
        <span class="arch-maps-line" />
      </div>
      <div class="arch-layer">
        <p class="arch-layer-tag arch-layer-tag-green">{{ zh ? '传输会话' : 'Transport session' }}</p>
        <p class="arch-layer-body">
          {{
            zh
              ? 'acpx 管理：后端真实运行的命名 acpx 会话。'
              : 'acpx-managed: the real named acpx session on the backend.'
          }}
        </p>
      </div>
    </div>
  </section>
</template>
