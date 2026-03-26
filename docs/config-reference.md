# weacpx 配置参考

`~/.weacpx/config.json` 是 weacpx 的主配置文件。

## 完整示例

```json
{
  "transport": {
    "type": "acpx-bridge",
    "command": "acpx",
    "sessionInitTimeoutMs": 120000
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
  "workspaces": {}
}
```

`transport.type` 默认为 `"acpx-bridge"`，其他字段留空或省略即可。agents 和 workspaces 可以先留空，后续在微信里通过命令创建。
