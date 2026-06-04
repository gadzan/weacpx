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
</script>

<template>
  <section class="cap-section">
    <div class="cap-head">
      <span class="cap-kicker">{{ t.kicker }}</span>
      <h2 class="cap-title">{{ t.title }}</h2>
    </div>

    <!-- Orchestration -->
    <div class="cap-panel">
      <div class="cap-copy">
        <span class="cap-tag">{{ t.orch.tag }}</span>
        <h3 class="cap-panel-title">{{ t.orch.title }}</h3>
        <p class="cap-panel-body">{{ t.orch.body }}</p>
        <a class="cap-link" :href="t.orch.link">{{ t.orch.linkText }} →</a>
      </div>
      <div class="cap-visual" aria-hidden="true">
        <div class="orch">
          <div class="orch-coord">{{ t.orch.coord }}</div>
          <div class="orch-rails">
            <div v-for="(w, i) in t.orch.workers" :key="w" class="orch-row" :style="{ '--d': i * 0.4 + 's' }">
              <span class="orch-rail"><span class="orch-packet" /></span>
              <span class="orch-worker">{{ w }}</span>
            </div>
          </div>
        </div>
      </div>
    </div>

    <!-- Scheduled tasks (reversed) -->
    <div class="cap-panel cap-reverse">
      <div class="cap-copy">
        <span class="cap-tag">{{ t.later.tag }}</span>
        <h3 class="cap-panel-title">{{ t.later.title }}</h3>
        <p class="cap-panel-body">{{ t.later.body }}</p>
        <a class="cap-link" :href="t.later.link">{{ t.later.linkText }} →</a>
      </div>
      <div class="cap-visual" aria-hidden="true">
        <div class="timeline">
          <div class="tl-axis">
            <span class="tl-now"><i class="tl-now-label">{{ t.later.nowLabel }}</i></span>
            <span
              v-for="(task, i) in t.later.tasks"
              :key="task.label"
              class="tl-task"
              :style="{ left: 22 + i * 28 + '%', '--d': i * 0.5 + 's' }"
            >
              <span class="tl-dot" />
              <span class="tl-chip">{{ task.at }} · {{ task.label }}</span>
            </span>
          </div>
        </div>
      </div>
    </div>

    <!-- Channels -->
    <div class="cap-panel">
      <div class="cap-copy">
        <span class="cap-tag">{{ t.chan.tag }}</span>
        <h3 class="cap-panel-title">{{ t.chan.title }}</h3>
        <p class="cap-panel-body">{{ t.chan.body }}</p>
        <a class="cap-link" :href="t.chan.link">{{ t.chan.linkText }} →</a>
      </div>
      <div class="cap-visual" aria-hidden="true">
        <div class="slots">
          <div class="slots-core">{{ t.chan.core }}</div>
          <div class="slots-list">
            <span
              v-for="(s, i) in t.chan.slots"
              :key="s"
              class="slot-chip"
              :class="{ 'slot-add': i === t.chan.slots.length - 1 }"
              :style="{ '--d': i * 0.35 + 's' }"
              >{{ s }}</span
            >
          </div>
        </div>
      </div>
    </div>
  </section>
</template>
