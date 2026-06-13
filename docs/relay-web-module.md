# Relay Web 看板模块说明（packages/relay-web）

relay hub 的 Web 看板（阶段三 + 阶段四）：登录后跨实例管理 acpx 会话的三栏 IM 界面。
设计 spec：docs/superpowers/specs/2026-06-13-relay-hub-design.md；服务端见 docs/relay-module.md。

## 目的与形态

三栏 IM 看板：

- **左栏**：实例-会话树（在线状态、运行中 ● 标记），新建/删除逻辑会话；顶部带 Settings / Logout；
- **中栏**：选中会话的聊天流（历史回显 + prompt 流式渲染，运行中可取消，输入框支持 `/命令`）；
- **右栏**：当前会话的任务面板（定时任务 + 编排任务，见下文 `TaskPanel`）。
- **设置页**（`/settings`）：实例配对 token 生成、管理员邀请、只读历史保留摘要。
- **全局**：底部右下角 `instance.notice` toast、离线时的 “Reconnecting…” 连接徽标。

## 技术栈

- Vue 3 + Vite + Pinia（状态）+ vue-router（路由）+ Tailwind CSS v3（样式）；
- 测试：Vitest + jsdom + @vue/test-utils（`src/__tests__/*.test.ts`）。

## 「快照 + 事件增量」模型

看板状态由两条路径维护，重连先拉快照再订阅事件：

- **快照**：REST 拉取——`GET /api/instances` 列实例，RPC `control.sessions.list` 列会话，
  会话历史经消息缓存 API 拉取（见服务端 `/api/instances/:id/sessions/:alias/messages`）；
- **事件增量**：`src/api/events.ts` 的 `connectEvents(onEvent, onStatus?)` 连接 `/ws`，
  `DashboardView` 把每条 `WebServerEvent` 扇出给四个 store：`instancesStore.applyEvent`
  （实例上下线/会话变更）、`chatStore.applyEvent`（control-event：turn 输出分片、turn 终态等）、
  `tasksStore.applyEvent`（`scheduled-changed`/`orchestration-changed` 信号触发重拉）、
  `noticesStore.applyEvent`（`instance.notice` toast）；并把 `connectEvents` 的 `onStatus`
  回调接到 `connectionStore.setOnline`，驱动连接徽标。

## 右栏任务面板（阶段四）

- `components/TaskPanel.vue`：选中会话时挂载，watch 聊天选择并调用 `tasksStore.loadFor(instanceId, alias)`；
  内部组合 `ScheduledTasks.vue`（列表 + 用 datetime-local + 文本框创建 / 取消）与
  `OrchestrationTasks.vue`（列表 / 取消）。
- `stores/tasks.ts`：调度器 + 编排的事实源仍在实例侧，store 只做查询/操作 + 事件触发重拉。
  - **设计取舍**：定时任务**按会话过滤**——relay 给 Web 频道盖戳 `chatKey=relay:<accountId>`，
    `control.scheduled.list` 返回的是整账号的任务，store 用 `t.sessionAlias === sessionAlias` 筛到当前会话；
    编排任务**按实例展示**（不按会话隔离），`control.orchestration.list` 整实例返回直接呈现。
  - `applyEvent` 只认当前 scope 实例的 `scheduled-changed`/`orchestration-changed`（裸信号），
    命中即分别 `loadScheduled`/`loadOrchestration` 重拉。

## 通知 / 连接 / 设置 store（阶段四）

- `stores/notices.ts` + `components/NoticeToast.vue`：把 `instance.notice` web 事件渲染成
  右下角可关闭 toast——newest-first，最多保留 20 条、同屏展示最多 4 条。
- `stores/connection.ts` + `components/ConnectionBadge.vue`：`connectEvents` 的 `onStatus`
  报告 `/ws` open/close，离线期间显示 “Reconnecting…” 徽标。
- `views/SettingsView.vue`（路由 `/settings`）：实例配对 token 生成器（回显
  `xacpx channel add relay --url ... --token ...` 命令）、admin-only 账号邀请生成器、
  只读历史保留摘要（来自 `GET /api/config`，保留策略服务端配置、v1 不可在 Web 改）。

## 聊天流式缓冲（阶段四加固）

- `stores/chat.ts` 的流式缓冲按 `${instanceId}\0${sessionAlias}`（NUL 分隔）键存放，
  切换会话时各自缓冲互不覆盖，能跨切换存活；某实例离线时按前缀清掉它名下所有缓冲。
- 发送失败时设置 `error` ref 做错误浮现；`control.command.execute` 与 `control.prompt` 发送均带 `sessionAlias`。

## 文件地图

- `src/api/client.ts` —— REST 客户端（登录、`/api/instances`、`/api/instances/:id/rpc` 代理调用、历史）；
- `src/api/events.ts` —— WS 客户端（`connectEvents` → `/ws`，自动重连）；
- `src/stores/auth.ts` —— 登录态；`src/stores/instances.ts` —— 实例/会话树 + `applyEvent`；
  `src/stores/chat.ts` —— 聊天流、NUL-key 流式缓冲、`error`、`loadHistory`/`send` + `applyEvent`；
  `src/stores/tasks.ts` —— 定时/编排（loadFor/create/cancel + `applyEvent`）；
  `src/stores/notices.ts` —— notice toast 队列；`src/stores/connection.ts` —— `/ws` 在线态；
- `src/views/LoginView.vue`、`src/views/DashboardView.vue`、`src/views/SettingsView.vue`；
- `src/components/InstanceTree.vue`、`ChatPane.vue`、`MessageList.vue`、`PromptInput.vue`、
  `TaskPanel.vue`、`ScheduledTasks.vue`、`OrchestrationTasks.vue`、`NoticeToast.vue`、`ConnectionBadge.vue`；
- `src/router/index.ts`（含 `/settings` 路由）、`src/main.ts`、`src/App.vue`、`src/style.css`。

## 如何与 relay 通信

- **REST**：`/api/*`（登录、实例列表、会话/历史快照），其中
  `POST /api/instances/:id/rpc` 是服务端盖戳的代理（覆写 chatKey/senderId/isOwner，只放行 control.*）；
- **WS**：`/ws`（cookie 鉴权的 web 事件扇出端点，与实例网关 wsPort 分离）。

## 生产托管与开发

- **生产**：`xacpx-relay start --web-root <dist>` 由 relay 服务静态托管构建产物（SPA fallback）；
- **开发**：`bun run --cwd packages/relay-web dev` 起 Vite dev server，
  Vite 代理把 `/api` 与 `/ws` 转发到 `:8787`（见 `packages/relay-web/vite.config.ts`）；
- **构建**：仓库根 `bun run build:relay-web`（先 build relay-protocol 再 vite build）；
- **测试**：仓库根 `bun run test:web`（Vitest）。

## 阶段范围边界

- **阶段三**交付登录 + 实例/会话树 + 对话流。
- **阶段四**补齐：右栏任务面板（定时/编排）、设置页（邀请/配对/保留摘要）、notice toast、
  连接恢复徽标、NUL-key 流式缓冲加固。
- 历史保留策略为服务端配置（`--history-retention-days`），v1 在 Web 端只读、不可编辑（见 docs/relay-module.md）。
