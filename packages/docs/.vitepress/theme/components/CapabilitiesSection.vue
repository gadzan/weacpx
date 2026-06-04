<script setup lang="ts">
// Secondary showcase: alternating rich panels with self-contained animated
// visuals for the remaining standout capabilities. Analog to Vite's
// "A shared foundation to build upon" section.
import { computed } from 'vue';
import { useData, withBase } from 'vitepress';

const { lang } = useData();
const zh = computed(() => lang.value.startsWith('zh'));

const t = computed(() => ({
  kicker: zh.value ? '更多能力' : 'More power',
  title: zh.value ? '不止是转发消息' : 'More than message relay',
  orch: {
    tag: zh.value ? '多 Agent 编排' : 'Multi-agent orchestration',
    title: zh.value ? '把任务分发给一队 Agent' : 'Delegate work across a fleet of agents',
    body: zh.value
      ? '一个协调者把子任务分发给多个 worker，再通过外部 MCP 接口汇总结果。'
      : 'A coordinator fans sub-tasks out to workers and gathers results back through the external MCP surface.',
    link: withBase('/reference/external-mcp'),
    linkText: zh.value ? '编排文档' : 'Orchestration',
    workers: zh.value ? ['Worker 甲', 'Worker 乙', 'Worker 丙'] : ['Worker A', 'Worker B', 'Worker C'],
    coord: zh.value ? '协调者' : 'Coordinator',
  },
  later: {
    tag: zh.value ? '定时任务' : 'Scheduled tasks',
    title: zh.value ? '让提示词稍后自动触发' : 'Queue prompts to fire later',
    body: zh.value
      ? '用 /later 排队相对或绝对时间的提示词——临时会话或绑定到已有会话。'
      : 'Queue prompts with /later — relative or absolute times, in a temporary or a bound session.',
    link: withBase('/guide/scheduled-tasks'),
    linkText: zh.value ? '定时任务' : 'Scheduled tasks',
    tasks: zh.value
      ? [
          { at: '+2h', label: '跑测试' },
          { at: '09:00', label: '发布' },
          { at: '明天', label: '清理' },
        ]
      : [
          { at: '+2h', label: 'run tests' },
          { at: '09:00', label: 'deploy' },
          { at: 'tmrw', label: 'cleanup' },
        ],
    nowLabel: zh.value ? '现在' : 'now',
  },
  chan: {
    tag: zh.value ? '可扩展频道' : 'Extensible channels',
    title: zh.value ? '把任意聊天平台插进核心' : 'Plug any chat platform into the core',
    body: zh.value
      ? '微信内置，飞书与元宝是官方插件——第三方频道遵循同一接口，无需改动核心。'
      : 'WeChat is built in; Feishu and Yuanbao are official plugins — third-party channels follow the same interface, no core changes.',
    link: withBase('/plugins/development'),
    linkText: zh.value ? '开发频道' : 'Build a channel',
    core: zh.value ? '核心' : 'core',
    slots: zh.value ? ['微信', '飞书', '元宝', '+ 你的'] : ['WeChat', 'Feishu', 'Yuanbao', '+ yours'],
  },
}));

// --- SVG scene geometry (shared viewBox space, animateMotion-aligned) -------
// Orchestration: coordinator (right edge 130,110) curves out to 3 workers.
function orchPath(i: number): string {
  const y = 60 + i * 70;
  return `M130,110 C 214,110 206,${y} 288,${y}`;
}
// Channels: core (right edge 84,115) radiates to 4 channel slots.
function chanPath(i: number): string {
  const y = 34 + i * 52;
  return `M84,115 C 166,115 170,${y} 250,${y}`;
}
// Timeline: a "now" head sweeps the axis; tasks ignite as it passes.
const TL_X0 = 34;
const TL_X1 = 392;
const tlTicks = Array.from({ length: 14 }, (_, i) => TL_X0 + i * ((TL_X1 - TL_X0) / 13));
function tlX(i: number): number {
  return 104 + i * 106;
}
function tlBegin(i: number): string {
  return (6 * ((tlX(i) - TL_X0) / (TL_X1 - TL_X0))).toFixed(2) + 's';
}
</script>

<template>
  <section class="cap-section">
    <div class="cap-head" v-reveal="0">
      <span class="cap-kicker">{{ t.kicker }}</span>
      <h2 class="cap-title">{{ t.title }}</h2>
    </div>

    <!-- Orchestration -->
    <div class="cap-panel" v-reveal="0">
      <div class="cap-copy">
        <span class="cap-tag">{{ t.orch.tag }}</span>
        <h3 class="cap-panel-title">{{ t.orch.title }}</h3>
        <p class="cap-panel-body">{{ t.orch.body }}</p>
        <a class="cap-link" :href="t.orch.link">{{ t.orch.linkText }} →</a>
      </div>
      <div class="cap-visual" aria-hidden="true">
        <svg class="scene orch-svg" viewBox="0 0 420 220" preserveAspectRatio="xMidYMid meet">
          <defs>
            <filter id="xGlow" x="-200%" y="-200%" width="500%" height="500%">
              <feGaussianBlur stdDeviation="2.4" />
            </filter>
          </defs>

          <!-- connectors -->
          <path
            v-for="(w, i) in t.orch.workers"
            :key="'wire' + i"
            class="wire"
            :d="orchPath(i)"
          />

          <!-- flowing packets -->
          <g v-for="(w, i) in t.orch.workers" :key="'flow' + i" class="flow">
            <circle class="flow-glow" r="6" />
            <circle class="flow-core" r="3" />
            <animateMotion
              :dur="'2.4s'"
              :begin="i * 0.55 + 's'"
              repeatCount="indefinite"
              :path="orchPath(i)"
              keyPoints="0;1"
              keyTimes="0;1"
              calcMode="spline"
              keySplines="0.5 0 0.5 1"
            />
          </g>

          <!-- coordinator -->
          <g class="node">
            <rect class="node-coord" x="14" y="84" width="116" height="52" rx="13" />
            <circle class="emit" cx="130" cy="110" r="4" />
            <text class="node-coord-t" x="72" y="110">{{ t.orch.coord }}</text>
          </g>

          <!-- workers -->
          <g v-for="(w, i) in t.orch.workers" :key="'wk' + i" class="node">
            <rect class="node-worker" x="288" :y="38 + i * 70" width="124" height="44" rx="11" />
            <circle class="wstatus" cx="304" :cy="60 + i * 70" r="3.6" :style="{ '--b': i * 0.55 + 's' }" />
            <text class="node-worker-t" x="318" :y="60 + i * 70">{{ w }}</text>
          </g>
        </svg>
      </div>
    </div>

    <!-- Scheduled tasks (reversed) -->
    <div class="cap-panel cap-reverse" v-reveal="0">
      <div class="cap-copy">
        <span class="cap-tag">{{ t.later.tag }}</span>
        <h3 class="cap-panel-title">{{ t.later.title }}</h3>
        <p class="cap-panel-body">{{ t.later.body }}</p>
        <a class="cap-link" :href="t.later.link">{{ t.later.linkText }} →</a>
      </div>
      <div class="cap-visual" aria-hidden="true">
        <svg class="scene tl-svg" viewBox="0 0 420 170" preserveAspectRatio="xMidYMid meet">
          <defs>
            <filter id="xGlowTl" x="-200%" y="-200%" width="500%" height="500%">
              <feGaussianBlur stdDeviation="2.4" />
            </filter>
            <linearGradient id="tlNowGrad" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0" stop-color="var(--x-accent)" stop-opacity="0" />
              <stop offset="0.5" stop-color="var(--x-accent-bright)" stop-opacity="1" />
              <stop offset="1" stop-color="var(--x-accent)" stop-opacity="0" />
            </linearGradient>
          </defs>

          <!-- axis + ticks -->
          <line class="tl-axis" x1="34" y1="95" x2="392" y2="95" />
          <line
            v-for="(x, i) in tlTicks"
            :key="'tk' + i"
            class="tl-tick"
            :x1="x"
            y1="91"
            :x2="x"
            y2="99"
          />

          <!-- tasks -->
          <g
            v-for="(task, i) in t.later.tasks"
            :key="task.label"
            class="tl-task"
            :style="{ '--b': tlBegin(i) }"
          >
            <circle class="tl-ring" :cx="tlX(i)" cy="95" r="6" />
            <circle class="tl-dot" :cx="tlX(i)" cy="95" r="5" />
            <text class="tl-chip" :x="tlX(i)" y="122">{{ task.at }} · {{ task.label }}</text>
          </g>

          <!-- sweeping now head -->
          <g class="tl-now">
            <animateTransform
              attributeName="transform"
              type="translate"
              from="0 0"
              to="358 0"
              dur="6s"
              repeatCount="indefinite"
            />
            <line class="tl-now-line" x1="34" y1="50" x2="34" y2="140" stroke="url(#tlNowGrad)" />
            <circle class="tl-now-head" cx="34" cy="95" r="4" filter="url(#xGlowTl)" />
            <circle class="tl-now-core" cx="34" cy="95" r="2.4" />
            <text class="tl-now-cap" x="34" y="42">{{ t.later.nowLabel }}</text>
          </g>
        </svg>
      </div>
    </div>

    <!-- Channels -->
    <div class="cap-panel" v-reveal="0">
      <div class="cap-copy">
        <span class="cap-tag">{{ t.chan.tag }}</span>
        <h3 class="cap-panel-title">{{ t.chan.title }}</h3>
        <p class="cap-panel-body">{{ t.chan.body }}</p>
        <a class="cap-link" :href="t.chan.link">{{ t.chan.linkText }} →</a>
      </div>
      <div class="cap-visual" aria-hidden="true">
        <svg class="scene chan-svg" viewBox="0 0 420 220" preserveAspectRatio="xMidYMid meet">
          <defs>
            <filter id="xGlowCh" x="-200%" y="-200%" width="500%" height="500%">
              <feGaussianBlur stdDeviation="2.4" />
            </filter>
          </defs>

          <!-- connectors -->
          <path
            v-for="(s, i) in t.chan.slots"
            :key="'cw' + i"
            class="wire"
            :class="{ 'wire-add': i === t.chan.slots.length - 1 }"
            :d="chanPath(i)"
          />

          <!-- flowing packets (not on the open +slot) -->
          <template v-for="(s, i) in t.chan.slots" :key="'cf' + i">
            <g v-if="i < t.chan.slots.length - 1" class="flow">
              <circle class="flow-glow" r="5.5" />
              <circle class="flow-core" r="2.8" />
              <animateMotion
                :dur="'2.6s'"
                :begin="i * 0.6 + 's'"
                repeatCount="indefinite"
                :path="chanPath(i)"
                keyPoints="0;1"
                keyTimes="0;1"
                calcMode="spline"
                keySplines="0.5 0 0.5 1"
              />
            </g>
          </template>

          <!-- core -->
          <g class="node">
            <rect class="node-core" x="18" y="82" width="66" height="66" rx="17" />
            <circle class="emit" cx="84" cy="115" r="4" />
            <text class="node-core-t" x="51" y="115">{{ t.chan.core }}</text>
          </g>

          <!-- channel slots -->
          <g
            v-for="(s, i) in t.chan.slots"
            :key="'cs' + i"
            class="node"
            :class="{ 'chan-add': i === t.chan.slots.length - 1 }"
          >
            <rect class="chan-slot" x="250" :y="14 + i * 52" width="152" height="40" rx="11" />
            <circle
              v-if="i < t.chan.slots.length - 1"
              class="cstatus"
              cx="266"
              :cy="34 + i * 52"
              r="3.4"
              :style="{ '--b': i * 0.6 + 's' }"
            />
            <text class="chan-slot-t" :x="i < t.chan.slots.length - 1 ? 282 : 326" :y="34 + i * 52">{{ s }}</text>
          </g>
        </svg>
      </div>
    </div>
  </section>
</template>
