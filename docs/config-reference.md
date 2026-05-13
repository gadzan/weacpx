# weacpx 配置参考

`~/.weacpx/config.json` 是 weacpx 的主配置文件。

如果你想管理微信/飞书消息频道，请看 [`docs/channel-management.md`](./channel-management.md)。如果你想在聊天里直接修改一部分配置，而不是手改 JSON，请看 [`docs/config-command.md`](./config-command.md)。

## 完整示例

```json
{
  "transport": {
    "type": "acpx-bridge",
    "command": "acpx",
    "sessionInitTimeoutMs": 120000
  },
  "channel": {
    "replyMode": "verbose"
  },
  "channels": [
    { "id": "weixin", "type": "weixin", "enabled": true }
  ],
  "plugins": [],
  "agents": {
    "codex": {
      "driver": "codex"
    },
    "claude": {
      "driver": "claude"
    }
  },
  "workspaces": {
    "backend": {
      "cwd": "/absolute/path/to/backend",
      "description": "backend repo"
    }
  },
  "orchestration": {
    "maxPendingAgentRequestsPerCoordinator": 3,
    "allowWorkerChainedRequests": false,
    "allowedAgentRequestTargets": [],
    "allowedAgentRequestRoles": []
  }
}
```

---

## `transport`

与 acpx 后端的通信方式。

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `type` | `"acpx-cli"` \| `"acpx-bridge"` | 是 | 通信方式。详见下方说明 |
| `command` | `string` | 否 | 显式指定 acpx 二进制路径。不填则按优先级自动查找 |
| `sessionInitTimeoutMs` | `number` | 否 | session 初始化超时时间（毫秒），默认 `120000`（2分钟） |

### `type` 可选值

#### `"acpx-cli"`（默认）

直接在当前进程里 spawn acpx 子进程，每次操作（prompt/cancel/ensureSession）都启动一个新进程，执行完退出。内部使用 `node-pty` 分配 PTY。

适合：本地开发、调试场景。

#### `"acpx-bridge"`

启动一个独立的 bridge 子进程（`bridge-main.ts`），acpx 在里面常驻运行。所有操作通过 stdin/stdout JSON 协议以 RPC 方式发送，acpx 进程不会每次命令都重启。

适合：生产环境、更稳定的长时间运行。

### `command` 解析优先级

当 `transport.command` 未指定时，按以下顺序查找 acpx：

1. 当前项目内安装的 `acpx`（`node_modules/.bin/acpx`）
2. Shell `PATH` 中的 `acpx`

显式指定 `command` 会覆盖上述行为。

### orchestration MCP 自动注入

weacpx 会在向 acpx session 发送普通 prompt 前，临时启动 acpx 的 queue owner，并通过 `ACPX_QUEUE_OWNER_PAYLOAD` 注入 `weacpx-orchestration` stdio MCP server。这样被 acpx 管理的 agent 可以看到 `delegate_request` 等 orchestration 工具。

这个兼容路径不会写入工作目录的 `.acpxrc.json`，也不会修改 `~/.acpx/config.json` 或替换 acpx home，因此不会影响 acpx 既有 sessions、流日志和 `index.json` 映射关系。

默认注入命令按以下顺序解析：

1. `WEACPX_CLI_COMMAND`
2. `WEACPX_DAEMON_ARG0` + 当前 Node 可执行文件
3. 当前进程入口 `process.argv[1]` + 当前 Node 可执行文件
4. `weacpx`

如果 weacpx 不是通过标准 CLI/daemon 启动，或路径需要特殊包装，可以显式设置 `WEACPX_CLI_COMMAND`，例如：

```bash
WEACPX_CLI_COMMAND="node /path/to/weacpx/dist/cli.js" weacpx run
```

---

## `channel`

全局消息平台默认配置。

### `channel.replyMode`

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `replyMode` | `"stream"` \| `"final"` \| `"verbose"` | 否 | 回复模式。默认 `"verbose"` |

说明：

- `stream`：有中间文本分段时，优先流式发送
- `final`：抑制中间文本分段，只在最后发送一次最终文本
- `verbose`：在 stream 基础上额外发送工具调用等实时事件
- 这个配置是**全局默认值**
- 可以通过 `/replymode` 为**当前逻辑会话**设置覆盖值
- `/replymode reset` 会清除当前会话覆盖，回退到 `channel.replyMode`
- `final` 只影响文本是否实时发送，不改变 acpx transport 的输出生成方式

### 兼容旧配置

旧配置文件中的 `wechat.replyMode` 仍然可以正常使用，加载时会自动映射到 `channel.replyMode`。保存后会写入 `channel` 格式。

---

## `channels`

多频道运行配置。定义要启动的消息频道列表。省略时根据 `channel.type`（旧单频道配置）自动生成。

推荐通过频道 CLI 管理这一段配置：

```bash
weacpx channel list
weacpx channel add feishu
weacpx channel disable weixin
weacpx restart
```

完整操作说明见：[docs/channel-management.md](./channel-management.md)。

### `ChannelRuntimeConfig`

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `id` | `string` | 是 | 频道唯一标识，必须与 `type` 相同（内置：`"weixin"`；插件：例如 `"feishu"`、`"yuanbao"`） |
| `type` | `string` | 是 | 频道类型。内置频道类型只有 `"weixin"`。`"feishu"` 由 `@ganglion/weacpx-channel-feishu` 提供，`"yuanbao"` 由 `@ganglion/weacpx-channel-yuanbao` 提供；其它类型由已安装插件提供 |
| `enabled` | `boolean` | 否 | 是否启用。默认 `true` |
| `options` | `object` | 视频道而定 | 频道配置（飞书/元宝字段见下方） |

### 飞书频道配置（`options`）

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `options.appId` | `string` | 单 bot 时必填；多 bot 可省 | 飞书应用 App ID。顶层填一份等价于"单 bot 默认账号"；多 bot 时把每个 bot 的 `appId` 写在 `accounts.<id>.appId`，顶层可留空 |
| `options.appSecret` | `string` | 单 bot 时必填；多 bot 可省 | 飞书应用 App Secret。规则同 `appId` |
| `options.domain` | `"feishu"` \| `"lark"` | 否 | API 域名。默认 `"feishu"` |
| `options.requireMention` | `boolean` | 否 | 群聊是否需要 @机器人。默认 `true` |
| `options.textMessageFormat` | `"text"` | 否 | 发送格式。当前仅支持 `"text"` |
| `options.dedupTtlMs` | `number` | 否 | 消息去重 TTL（毫秒）。默认 `43200000`（12 小时） |
| `options.dedupMaxEntries` | `number` | 否 | 去重缓存最大条目。默认 `5000` |
| `options.defaultAccount` | `string` | 否 | 多 bot 模式下的默认账号 id；省略时优先 `default`，否则取第一个 `accounts.<id>` |
| `options.accounts` | `object` | 否 | 按 `accountId` 索引的多账号覆盖配置；每个子项可覆盖 `appId/appSecret/domain/requireMention/dmPolicy/groupPolicy/allowFrom/enabled/name`。chatKey 形如 `feishu:<accountId>:<chatId>`。详见 [docs/channel-management.md](./channel-management.md#飞书多-bot同一频道多个账号) |
| `options.dmPolicy` | `"open"` \| `"allowlist"` \| `"disabled"` | 否 | 私聊准入策略，默认 `"open"`（保持旧行为，任何人发起私聊都接收）。`"allowlist"` 时只接受 `allowFrom` 列表中的发送者；`"disabled"` 时全部丢弃 |
| `options.groupPolicy` | `"open"` \| `"allowlist"` \| `"disabled"` | 否 | 群聊准入策略，默认 `"open"`。语义同 `dmPolicy`，`requireMention` 仍然独立生效 |
| `options.allowFrom` | `string[]` | 否 | 发送者 `open_id` 白名单；只在任一 policy 为 `"allowlist"` 时生效。包含 `"*"` 等价于"任何带 open_id 的发送者"。`allowlist` 模式下不能为空 |
| `options.replyMode` | `"static"` \| `"streaming"` \| `"auto"` | 否 | 回复呈现方式。默认 `"auto"`(私聊走 streaming、群聊走 static);`"static"` 为多条独立文本消息;`"streaming"` 改为一张 CardKit v2 交互卡片在一条消息里原地更新(thinking → streaming → complete/aborted/error,带耗时 footer、自动 reasoning 折叠、markdown 图片 URL → image_key 解析、字符级流式更新)。机器人需具有 `cardkit:card:write` + `im:message:send_as_bot` 权限;首次创建卡片失败时会自动回退到 static 并打印 `feishu.streaming.fallback` 日志(权限缺失还会一次性把授权链接发给用户)。也可在 `options.accounts.<id>.replyMode` 上做账号级覆盖 |

### 元宝频道配置（`options`，由 `@ganglion/weacpx-channel-yuanbao` 提供）

元宝频道由插件 `@ganglion/weacpx-channel-yuanbao` 提供：插件内置元宝签名、WebSocket、消息收发、chatKey 路由、inbound → agent、去重、同会话串行和基础 outbound 策略。先 `weacpx plugin add @ganglion/weacpx-channel-yuanbao`，再添加频道；正常用户不需要配置 gateway module。

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `options.appKey` | `string` | 与 `appSecret` 成对必填 | 元宝机器人 App Key |
| `options.appSecret` | `string` | 与 `appKey` 成对必填 | 元宝机器人 App Secret |
| `options.token` | `string` | 否 | 静态 token；兼容 `appKey:appSecret` 形式，加载时会拆成 appKey/appSecret。真正的静态 auth token 需要同时配置 `botId` |
| `options.gatewayModule` | `string` | 否 | 兼容旧配置/开发调试用的外部 gateway 覆盖；普通用户不要配置 |
| `options.botId` | `string` | 否 | 机器人账号 ID，用于本地识别 @机器人 与过滤自消息；通常 sign-token 会返回并自动补齐 |
| `options.apiDomain` | `string` | 否 | 元宝 API 域名，默认 `"bot.yuanbao.tencent.com"` |
| `options.wsUrl` | `string` | 否 | 元宝 WebSocket 地址，默认 `"wss://bot-wss.yuanbao.tencent.com/wss/connection"` |
| `options.requireMention` | `boolean` | 否 | 群聊是否需要 @机器人。默认 `true` |
| `options.replyToMode` | `"off"` \| `"first"` \| `"all"` | 否 | 引用回复策略，默认 `"first"` |
| `options.overflowPolicy` | `"stop"` \| `"split"` | 否 | 超长文本策略，默认 `"split"` |
| `options.maxChars` | `number` | 否 | weacpx 出站文本拆分阈值，默认 `3000` |
| `options.outboundQueueStrategy` | `"immediate"` \| `"merge-text"` | 否 | gateway 可用的预留字段；weacpx 当前不执行合并队列 |
| `options.minChars` / `options.idleMs` | `number` | 否 | gateway 可用的预留字段；weacpx 当前不执行基于空闲时间的合并 |
| `options.mediaMaxMb` | `number` | 否 | 媒体大小上限，默认 `20` |
| `options.historyLimit` | `number` | 否 | gateway 可用的预留字段，默认 `100` |
| `options.disableBlockStreaming` | `boolean` | 否 | 是否禁用块状流式回复，默认 `false` |
| `options.fallbackReply` | `string` | 否 | agent 无文本返回时发送的兜底文案 |
| `options.markdownHintEnabled` | `boolean` | 否 | gateway 可用的预留字段，默认 `true` |
| `options.accounts` | `object` | 否 | 多账号覆盖配置；子项会继承顶层配置 |

### 示例

仅微信：

```json
{
  "channels": [
    { "id": "weixin", "type": "weixin", "enabled": true }
  ]
}
```

微信 + 飞书：

```json
{
  "channels": [
    { "id": "weixin", "type": "weixin", "enabled": true },
    {
      "id": "feishu",
      "type": "feishu",
      "enabled": true,
      "options": {
        "appId": "cli_xxx",
        "appSecret": "...",
        "domain": "feishu"
      }
    }
  ]
}
```

元宝（需先安装 `@ganglion/weacpx-channel-yuanbao`）：

```json
{
  "plugins": [
    { "name": "@ganglion/weacpx-channel-yuanbao", "enabled": true }
  ],
  "channels": [
    {
      "id": "yuanbao",
      "type": "yuanbao",
      "enabled": true,
      "options": {
        "appKey": "yb_xxx",
        "appSecret": "...",
        "requireMention": true
      }
    }
  ]
}
```

### 兼容旧配置

旧配置文件中的 `channel.type` 仍然可以正常使用，加载时会自动生成单频道的 `channels[]`。新的多频道配置推荐使用 `weacpx channel ...` 管理。

旧版飞书配置中的 `feishu` 对象仍作为 legacy alias 兼容读取；新配置请统一写入 `options`。

---

## `plugins`

通过 `weacpx plugin add <npm-package>` 安装的外部插件包。

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `name` | `string` | 是 | npm 包名 |
| `version` | `string` | 否 | 安装时记录的版本范围或版本号 |
| `enabled` | `boolean` | 否 | 是否加载该插件，默认 `true` |

`plugins[]` is lifecycle metadata for packages installed under `~/.weacpx/plugins`. It does not enable a channel by itself; `channels[]` still controls which channel runtimes start. After changing plugin install, update, enable, disable, or remove state while the daemon is running, restart the daemon so plugin registration is reloaded.

安装插件只表示频道类型可用，不会自动启用频道。启用频道仍然需要：

```bash
weacpx channel add <channel-type>
```

详见 [`docs/plugin-development.md`](./plugin-development.md)。

---

## `agents`

注册的 agent 映射表，key 为 agent 名称（供 `/agent add`、`/session new --agent` 使用）。

### Agent 配置

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `driver` | `string` | 是 | agent 驱动类型，传递给 acpx 的第一位置参数 |
| `command` | `string` | 否 | 显式指定自定义 agent 的原始命令。不填则使用 acpx 默认行为 |

说明：

- 内置 `codex` 和 `claude` 建议只写 `driver`，让 `acpx` 自己解析对应 alias
- `agent.command` 主要用于自定义 agent，不建议给内置 driver 手写原始命令
- 旧版 `codex` raw command 配置在加载时会被自动忽略，回退为 `acpx codex ...`

### 内置模板

通过微信发送 `/agent add <name>` 时使用以下内置模板：

| 模板名 | driver | command |
|--------|--------|---------|
| `codex` | `"codex"` | 无（使用 acpx 默认） |
| `claude` | `"claude"` | 无（使用 acpx 默认） |

### 示例

```json
{
  "agents": {
    "codex": {
      "driver": "codex"
    },
    "claude": {
      "driver": "claude"
    },
    "my-agent": {
      "driver": "custom",
      "command": "/usr/local/bin/my-agent"
    }
  }
}
```

---

## `workspaces`

注册的工作区映射表，key 为工作区名称（供 `/workspace new`、`/session new --ws` 使用）。

### Workspace 配置

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `cwd` | `string` | 是 | 工作区的绝对路径，acpx 的 `--cwd` 参数 |
| `description` | `string` | 否 | 描述信息，供 `/workspaces` 命令展示用 |

### 示例

```json
{
  "workspaces": {
    "backend": {
      "cwd": "/Users/name/Projects/backend",
      "description": "backend repo"
    },
    "frontend": {
      "cwd": "/Users/name/Projects/frontend"
    }
  }
}
```

---

## `orchestration`

控制 agent 发起委派请求时的默认守卫策略。

### `orchestration.*`

| 字段 | 类型 | 必填 | 默认值 | 说明 |
|------|------|------|--------|------|
| `maxPendingAgentRequestsPerCoordinator` | `number` | 否 | `3` | 单个 coordinator 下允许同时处于 `needs_confirmation` / `running` 的 agent 发起委派任务上限 |
| `allowWorkerChainedRequests` | `boolean` | 否 | `false` | 是否允许 worker 会话再发起委派请求。默认拒绝，避免多跳扩散 |
| `allowedAgentRequestTargets` | `string[]` | 否 | `[]` | 允许 agent 发起委派时指定的目标 agent 白名单。空数组表示不额外限制 |
| `allowedAgentRequestRoles` | `string[]` | 否 | `[]` | 允许 agent 发起委派时使用的 role 白名单。空数组表示不额外限制 |

### 示例

```json
{
  "orchestration": {
    "maxPendingAgentRequestsPerCoordinator": 5,
    "allowWorkerChainedRequests": false,
    "allowedAgentRequestTargets": ["claude", "codex"],
    "allowedAgentRequestRoles": ["reviewer", "planner"]
  }
}
```

---

## 环境变量覆盖

以下环境变量可覆盖配置文件路径：

| 环境变量 | 说明 |
|----------|------|
| `WEACPX_CONFIG` | 配置文件路径（默认 `~/.weacpx/config.json`） |
| `WEACPX_STATE` | 状态文件路径（默认 `~/.weacpx/state.json`） |
| `WEACPX_WEIXIN_SDK` | 强制指定 weixin-agent-sdk 入口文件路径 |

---

## 最小配置

以下配置即可正常启动：

```json
{
  "transport": {},
  "agents": {},
  "workspaces": {},
  "orchestration": {}
}
```

`transport.type` 默认为 `"acpx-bridge"`，其他字段留空或省略即可。agents 和 workspaces 可以先留空，后续在聊天里通过命令创建。

---

## 通过聊天命令修改配置

weacpx 支持通过 `/config` 和 `/config set <path> <value>` 修改**部分受支持字段**。

注意：

- `/config` 不是任意 JSON 编辑器
- 只允许修改白名单中的路径
- `agents.<name>.*` / `workspaces.<name>.*` 仅在目标已存在时允许修改

详见 [`docs/config-command.md`](./config-command.md)。
