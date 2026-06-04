<script setup lang="ts">
// Flagship "show, don't tell" section: a self-playing chat thread that
// demonstrates driving an agent session end to end. Our analog to Vite's
// animated terminal / HMR demos. Loops; static for reduced-motion / SSR.
import { ref, computed, onMounted, onUnmounted, nextTick, watch } from 'vue';
import { useData } from 'vitepress';

const { lang } = useData();
const zh = computed(() => lang.value.startsWith('zh'));

interface Msg {
  from: 'user' | 'bot';
  text: string;
}

const scriptEn: Msg[] = [
  { from: 'user', text: '/ss codex -d ~/projects/api' },
  { from: 'bot', text: '✓ Session "api" ready\ncodex · ~/projects/api' },
  { from: 'user', text: 'add a /health endpoint and run the tests' },
  { from: 'bot', text: 'Added GET /health → { status: "ok" }\nRan 24 tests — all green ✓' },
  { from: 'user', text: '/status' },
  { from: 'bot', text: '● api · codex · idle · last reply 12s ago' },
];

const scriptZh: Msg[] = [
  { from: 'user', text: '/ss codex -d ~/projects/api' },
  { from: 'bot', text: '✓ 会话 "api" 就绪\ncodex · ~/projects/api' },
  { from: 'user', text: '加一个 /health 接口并跑测试' },
  { from: 'bot', text: '已新增 GET /health → { status: "ok" }\n运行 24 个测试 — 全部通过 ✓' },
  { from: 'user', text: '/status' },
  { from: 'bot', text: '● api · codex · 空闲 · 12 秒前回复' },
];

const steps = computed(() => (zh.value ? scriptZh : scriptEn));

const captions = computed(() =>
  zh.value
    ? [
        { n: '01', title: '创建会话', body: '一条命令绑定 agent 与工作区。' },
        { n: '02', title: '发送提示词', body: '任何不以 / 开头的消息直达 agent。' },
        { n: '03', title: '全程掌控', body: '随时 /status、/cancel、/use 切换。' },
      ]
    : [
        { n: '01', title: 'Start a session', body: 'One command binds an agent to a workspace.' },
        { n: '02', title: 'Send a prompt', body: 'Any non-slash message goes straight to the agent.' },
        { n: '03', title: 'Stay in control', body: '/status, /cancel, /use — switch live, anytime.' },
      ],
);

const visible = ref<Msg[]>([]);
const typing = ref(false);
const thread = ref<HTMLElement | null>(null);
let timers: ReturnType<typeof setTimeout>[] = [];

function clearTimers() {
  timers.forEach((t) => clearTimeout(t));
  timers = [];
}

function scrollToEnd() {
  nextTick(() => {
    const el = thread.value;
    if (el) el.scrollTop = el.scrollHeight;
  });
}

function run() {
  clearTimers();
  visible.value = [];
  typing.value = false;
  let t = 700;
  for (const m of steps.value) {
    if (m.from === 'bot') {
      timers.push(setTimeout(() => (typing.value = true), t));
      t += 950;
      timers.push(
        setTimeout(() => {
          typing.value = false;
          visible.value.push(m);
        }, t),
      );
      t += 1150;
    } else {
      timers.push(setTimeout(() => visible.value.push(m), t));
      t += 1200;
    }
  }
  timers.push(setTimeout(run, t + 2800)); // hold, then loop
}

watch([visible, typing], scrollToEnd, { deep: true });

function start() {
  const reduced = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;
  if (reduced) {
    clearTimers();
    visible.value = [...steps.value];
    return;
  }
  run();
}

onMounted(start);

// The home Layout keeps this section mounted across locale switches, so the
// running thread would otherwise keep replaying the previous language until
// its next loop. Restart immediately when the language changes.
watch(zh, start);

onUnmounted(clearTimers);
</script>

<template>
  <section class="demo-section">
    <div class="demo-head" v-reveal="0">
      <span class="demo-kicker">{{ zh ? '实际效果' : 'See it work' }}</span>
      <h2 class="demo-title">
        {{ zh ? '在一条对话里跑完整个会话' : 'Drive a whole session from one thread' }}
      </h2>
      <p class="demo-sub">
        {{
          zh
            ? '创建、提示、查看——全程不碰终端。'
            : 'Start it, prompt it, check on it — without ever opening a terminal.'
        }}
      </p>
    </div>

    <div class="demo-stage">
      <ol class="demo-steps">
        <li v-for="(c, i) in captions" :key="c.n" class="demo-step" v-reveal="i">
          <span class="demo-step-n">{{ c.n }}</span>
          <div>
            <p class="demo-step-title">{{ c.title }}</p>
            <p class="demo-step-body">{{ c.body }}</p>
          </div>
        </li>
      </ol>

      <div class="demo-chat" aria-hidden="true" v-reveal="1">
        <div class="demo-chat-bar">
          <span class="demo-dot demo-dot-r" />
          <span class="demo-dot demo-dot-y" />
          <span class="demo-dot demo-dot-g" />
          <span class="demo-chat-title">xacpx · codex</span>
        </div>
        <div ref="thread" class="demo-thread">
          <transition-group name="bubble">
            <div
              v-for="(m, i) in visible"
              :key="i"
              class="demo-msg"
              :class="m.from === 'user' ? 'is-user' : 'is-bot'"
            >
              <span class="demo-bubble">{{ m.text }}</span>
            </div>
          </transition-group>
          <div v-if="typing" class="demo-msg is-bot">
            <span class="demo-bubble demo-typing">
              <i /><i /><i />
            </span>
          </div>
        </div>
      </div>
    </div>
  </section>
</template>
