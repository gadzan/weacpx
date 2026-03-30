# weacpx 

使用微信 ClawBot 随时随地通过 `acpx` 控制 Claude Code、Codex 等 Agents。

## 安装前准备

开始前，至少需要：

- Node.js 22+ 或 Bun
- 一个可用的微信登录环境
- Claude Code 或 Codex

> `weacpx` 基于 `weixin-agent-sdk` 与 `acpx` 实现。
> 正常情况下，不需要再额外全局安装 `acpx`。

## 安装

全局安装：

```bash
# 使用 NPM 全局安装
npm install -g weacpx
# 或使用 Bun 全局安装
bun add -g weacpx
```

## 快速开始

第一次使用建议按这个顺序：

1. 登录微信 `weacpx login`
2. 启动服务 `weacpx start`
3. 在微信里创建会话并开始对话

`weacpx login` 会在终端里显示二维码，使用微信扫描登录。`weacpx start` 启动后，在微信里发：

```text
/ss codex -d /absolute/path/to/your/repo

/help
```

`/ss codex -d /absolute/path/to/your/repo`：开启或挂在一个会话，并切换到该会话。使用 Codex，并指定工作目录为 `/absolute/path/to/your/repo`。

`/help` 查看帮助信息。

然后就可以直接发普通消息，例如：

```text
hello
```

如果任务比较长，`weacpx` 会优先把 Agent 的中间回复分段发回微信，而不是一直等到最后一条结果。

如果你是从源码仓库直接使用：

```bash
# 先安装依赖
bun install
# 登录微信
bun run login
# 启动服务
bun run dev
```

普通文本会默认发送到当前选中的 session。

## CLI 命令

常用命令：

- `weacpx login`
- `weacpx logout`
- `weacpx run`
- `weacpx start`
- `weacpx status`
- `weacpx stop`

说明：

- `run` 前台运行，适合调试
- `start` 后台启动
- `status` 查看后台状态、PID、配置路径和日志路径
- `stop` 停止后台实例
- `logout` 清除本机已保存的微信登录凭证；如果当前没有已登录账号，会直接提示

说明：

- `weacpx logout` 只清理已保存的微信账号凭证
- 它不会停止当前 daemon，也不会删除 `weacpx` 的 session/state 配置

## 微信中使用说明

### 管理 Agent

内置 `codex` 与 `claude` 两个常见 agent，也支持添加你自己的 agents。

| 命令 | 说明 |
|------|------|
| `/agents` | 查看当前已添加的 agent |
| `/agent add codex` | 添加 codex agent |
| `/agent add claude` | 添加 claude agent |
| `/agent rm <name>` | 删除 agent |

说明：

- 内置 `codex` 和 `claude` 走 `acpx` 的 driver alias，通常不需要额外写 `agent.command`
- 如果你接入的是自定义 agent，再考虑显式配置 `agent.command`

`config.json` 中的 `agent.command` 用于显式指定 agent 的原始启动命令，完整字段如下：

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `driver` | `string` | 是 | agent 驱动类型，传递给 acpx 的第一位置参数 |
| `command` | `string` | 否 | 显式指定自定义 agent 的原始命令。不填则使用 acpx 默认行为 |

示例 — 配置一个自定义 agent：

```json
{
  "agents": {
    "my-agent": {
      "driver": "codex",
      "command": "/path/to/acpx codex --arg1 value1"
    }
  }
}
```

- 内置 `codex` 和 `claude` 建议只写 `driver`，让 `acpx` 自己解析对应 alias
- `command` 主要用于自定义 agent，不建议给内置 driver 手写原始命令
- 旧版 `codex` raw command 配置会被自动忽略，回退为 `acpx codex ...`

### Workspace 工作目录

| 命令 | 说明 |
|------|------|
| `/workspaces` / `/workspace` / `/ws` | 查看当前已添加的工作目录 |
| `/ws new <name> -d <path>` | 添加工作目录，`-d` 后面接的是目录在电脑的绝对路径 |
| `/workspace rm <name>` | 删除工作目录 |

说明：

- `/ws new` 会先校验路径是否存在
- Windows 路径里如果有空格，请给 `-d` 或 `--cwd` 的值加引号，例如：`/ws new backend -d "E:\my projects\backend"`

### Session 会话

| 命令 | 说明 |
|------|------|
| `/sessions` / `/session` / `/ss` | 查看当前已添加的会话 |
| `/ss <agent> -d <path>` | 新建会话（自动按目录名推导并创建或复用 workspace，再创建或复用 session） |
| `/ss new <agent> -d <path>` | 强制新建会话 |
| `/ss new <alias> -a <name> --ws <name>` | 强制新建会话，并指定 agent 和 workspace |
| `/ss attach <alias> -a <name> --ws <name> --name <transport-session>` | 恢复已存在的会话 |
| `/use <alias>` | 切换当前会话 |
| `/status` | 查看当前会话状态 |
| `/cancel` | 取消当前会话 |
| `/stop` | 停止当前会话 |

说明：

- `/ss <agent> -d <path>` 是最常用入口，会自动按目录名推导并创建或复用 workspace，再创建或复用 session
- `/ss new <agent> -d <path>` 表示强制新建 session
- `/use <alias>` 用来切换当前会话
- 非 `/` 开头的文本会发送到当前 session

### 权限策略

`weacpx` 支持直接在微信里查看和切换 `acpx` 的权限策略。

| 命令 | 说明 |
|------|------|
| `/pm` / `/permission` | 查看当前权限模式 |
| `/pm set allow` | 切到 `approve-all` |
| `/pm set read` | 切到 `approve-reads` |
| `/pm set deny` | 切到 `deny-all` |
| `/pm auto` | 查看当前非交互策略 |
| `/pm auto allow` | 切到 `allow` |
| `/pm auto deny` | 切到 `deny` |
| `/pm auto fail` | 切到 `fail` |

说明：

- `allow` 对应 `approve-all`
- `read` 对应 `approve-reads`
- `deny` 对应 `deny-all`
- `/pm auto ...` 修改的是 `transport.nonInteractivePermissions`
- 这些命令会把结果写回 `config.json`

### 推荐工作流

新建一个可聊天的会话：

```text
/ss codex -d /absolute/path/to/backend
修一下最近这个接口超时问题
```

在同一个聊天里切换多个会话：

```text
/ss new codex -d /absolute/path/to/backend
/ss
/use backend:codex
看一下接口日志
/use backend:codex-2
看一下前端报错
```

删除不再需要的资源：

```text
/agent rm claude
/workspace rm old-repo
```

### 微信内置登录相关指令

除了 `weacpx login` / `weacpx logout` 这类 CLI 命令外，微信通道里还支持少量内置 slash 指令：

| 命令 | 说明 |
|------|------|
| `/clear` | 清除当前聊天会话，上下文重新开始 |
| `/logout` | 清除当前机器上已保存的所有微信账号凭证 |

说明：

- `/logout` 的语义和 CLI 的 `weacpx logout` 一致，都是清凭证
- 如果当前没有已登录账号，会提示“当前没有已登录的账号”
- `/logout` 不会停止后台服务，也不会删除 `weacpx` 的工作区、agent、session 状态

## 配置与运行文件

默认文件位置：

- 配置文件：`~/.weacpx/config.json`
- 状态文件：`~/.weacpx/state.json`
- 运行日志：`~/.weacpx/runtime/app.log`

后台运行时还会使用：

- `~/.weacpx/runtime/daemon.pid`
- `~/.weacpx/runtime/status.json`
- `~/.weacpx/runtime/stdout.log`
- `~/.weacpx/runtime/stderr.log`

常用环境变量：

- `WEACPX_CONFIG`
- `WEACPX_STATE`
- `WEACPX_WEIXIN_SDK`

### Transport 权限配置

`config.json` 中的 `transport` 支持以下权限字段：

```json
{
  "transport": {
    "type": "acpx-bridge",
    "sessionInitTimeoutMs": 120000,
    "permissionMode": "approve-all",
    "nonInteractivePermissions": "fail"
  }
}
```

说明：

- `permissionMode`: `approve-all`、`approve-reads`、`deny-all`
- `nonInteractivePermissions`: `allow`、`deny`、`fail`
- 默认值分别是 `approve-all` 和 `fail`
- 也可以直接在微信里通过 `/pm` 和 `/pm auto` 修改

### 日志配置

`config.json` 支持可选的 `logging` 配置：

```json
{
  "logging": {
    "level": "info",
    "maxSizeBytes": 2097152,
    "maxFiles": 5,
    "retentionDays": 7
  }
}
```

说明：

- `level`: `error`、`info`、`debug`
- `maxSizeBytes`: 单个 `app.log` 文件达到上限后会轮转
- `maxFiles`: 最多保留多少个轮转文件
- `retentionDays`: 每次启动时会清理超过保留天数的旧轮转日志

## 注意事项

### `dry-run`

`dry-run` 会复用同一套 router、session service、transport，只是把微信消息换成终端输入，适合本地排查。

示例：

```bash
bun run dry-run --chat-key wx:test -- \
  "/agent add codex" \
  "/ws new backend -d /absolute/path/to/backend" \
  "/ss new demo -a codex --ws backend" \
  "/status"
```

### 如果 `/ss new` 失败

当前最常见的问题仍然是底层 `acpx` named session 的运行时恢复，不一定是 `weacpx` 本身的逻辑问题。

可以先在本地创建一个 named session，再在微信里 attach：

```bash
./node_modules/.bin/acpx --verbose --cwd /absolute/workspace/path codex sessions new --name existing-demo
```

然后在微信里：

```text
/ss attach demo -a codex --ws backend --name existing-demo
```

## 更多文档

- 配置参考：[docs/config-reference.md](./docs/config-reference.md)
- 测试说明：[docs/testing.md](./docs/testing.md)
- 开发与贡献：[docs/development.md](./docs/development.md)
