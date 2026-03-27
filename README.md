# weacpx 

通过微信 ClawBot 远程控制通过 `acpx` 控制 Claude Code、Codex 等 Agents。

## weacpx 是什么

`weacpx` 基于以下组件工作：

- `weixin-agent-sdk`
- `acpx`
- `acpx` 已支持的 agent driver，或自定义 ACP agent

它适合这样的场景：

- 你已经在本机使用 `acpx`
- 你希望通过微信远程发起或继续一个 agent 会话
- 你希望在手机上完成常见的会话切换、目录切换和对话操作

## 安装前准备

开始前，至少需要：

- Node.js 22+
- Bun
- 一个可用的微信登录环境
- 本机可以运行 `acpx` 及其目标 agent

正常情况下，不需要再额外全局安装 `acpx`。

## 安装

全局安装：

```bash
# 使用 NPM 全局安装
npm install -g weacpx
# 或使用 bun 全局安装
bun add -g weacpx
```

如果你是从源码仓库直接使用，请先安装依赖并构建：

```bash
bun install
bun run dev
```

## 快速开始

第一次使用建议按这个顺序：

1. 登录微信
2. 启动服务
3. 在微信里创建会话并开始对话

如果你是全局安装版本：

```bash
weacpx login
weacpx start
weacpx status
```

如果你是在仓库里本地运行：

```bash
bun run login
bun run dev
```

`weacpx login` 和 `bun run login` 都会在终端里显示二维码。

启动后，在微信里先发：

```text
/ss codex -d /absolute/path/to/your/repo

/help
```

第一行的意思是：开启或挂在一个会话，并切换到该会话。使用 Codex，并指定工作目录为 `/absolute/path/to/your/repo`。
第二行的意思是：查看帮助信息。

然后就可以直接发普通消息，例如：

```text
hello
```

普通文本会默认发送到当前选中的 session。

## CLI 命令

常用命令：

- `weacpx login`
- `weacpx run`
- `weacpx start`
- `weacpx status`
- `weacpx stop`

说明：

- `run` 前台运行，适合调试
- `start` 后台启动
- `status` 查看后台状态、PID、配置路径和日志路径
- `stop` 停止后台实例

## 微信中如何使用

### Agent

内置 `codex` 与 `claude` 两个常见模板，也支持添加你自己的 agent。

- `/agents` 查看当前已添加的 agent
- `/agent add codex` 添加 codex agent
- `/agent add claude` 添加 claude agent
- `/agent rm <name>` 删除 agent

说明：

- 内置 `codex` 和 `claude` 走 `acpx` 的 driver alias，通常不需要额外写 `agent.command`
- 如果你接入的是自定义 agent，再考虑显式配置 `agent.command`

### Workspace 工作目录

- `/workspaces` 或 `/workspace` 或 `/ws` 可查看当前已添加的工作目录
- `/ws new <name> -d <path>` 添加工作目录，`-d` 后面接的是目录在电脑的绝对路径
- `/workspace rm <name>` 删除工作目录

说明：

- `/ws new` 会先校验路径是否存在
- Windows 路径里如果有空格，请给 `-d` 或 `--cwd` 的值加引号，例如：`/ws new backend -d "E:\my projects\backend"`

### Session 会话

- `/sessions` 或 `/session` 或 `/ss` 可查看当前已添加的会话
- `/ss <agent> -d <path>` 新建会话，会自动按目录名推导并创建或复用 workspace，再创建或复用 session
- `/ss new <agent> -d <path>` 强制新建会话
- `/ss new <alias> -a <name> --ws <name>` 强制新建会话，并指定 agent 和 workspace
- `/ss attach <alias> -a <name> --ws <name> --name <transport-session>` 恢复已存在的会话
- `/use <alias>` 切换当前会话
- `/status` 查看当前会话状态
- `/cancel` 取消当前会话
- `/stop` 停止当前会话

说明：

- `/ss <agent> -d <path>` 是最常用入口，会自动按目录名推导并创建或复用 workspace，再创建或复用 session
- `/ss new <agent> -d <path>` 表示强制新建 session
- `/use <alias>` 用来切换当前会话
- 非 `/` 开头的文本会发送到当前 session

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
