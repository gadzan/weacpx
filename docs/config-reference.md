# weacpx 配置参考

`~/.weacpx/config.json` 是 weacpx 的主配置文件。

如果你想在微信里直接修改一部分配置，而不是手改 JSON，请看 [`docs/config-command.md`](./config-command.md)。

## 完整示例

```json
{
  "transport": {
    "type": "acpx-bridge",
    "command": "acpx",
    "sessionInitTimeoutMs": 120000
  },
  "wechat": {
    "replyMode": "verbose"
  },
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

## `wechat`

控制微信侧回复投递行为。

### `wechat.replyMode`

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `replyMode` | `"stream"` \| `"final"` \| `"verbose"` | 否 | 微信回复模式。默认 `"verbose"` |

说明：

- `stream`：有中间文本分段时，优先流式发送到微信
- `final`：抑制中间文本分段，只在最后发送一次最终文本
- `verbose`：在 stream 基础上额外发送工具调用等实时事件
- 这个配置是**全局默认值**
- 可以通过 `/replymode` 为**当前逻辑会话**设置覆盖值
- `/replymode reset` 会清除当前会话覆盖，回退到 `wechat.replyMode`
- `final` 只影响微信侧文本是否实时发送，不改变 acpx transport 的输出生成方式

### 示例

```json
{
  "wechat": {
    "replyMode": "verbose"
  }
}
```

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

`transport.type` 默认为 `"acpx-bridge"`，其他字段留空或省略即可。agents 和 workspaces 可以先留空，后续在微信里通过命令创建。

---

## 通过微信修改配置

weacpx 支持通过 `/config` 和 `/config set <path> <value>` 修改**部分受支持字段**。

注意：

- `/config` 不是任意 JSON 编辑器
- 只允许修改白名单中的路径
- `agents.<name>.*` / `workspaces.<name>.*` 仅在目标已存在时允许修改

详见 [`docs/config-command.md`](./config-command.md)。
