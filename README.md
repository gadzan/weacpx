# weacpx Console

用微信远程控制 `acpx` 会话的控制台，底层基于：

- `weixin-agent-sdk`
- `acpx`
- `acpx` 已支持的 agent driver，或自定义 ACP agent

核心目标是：在微信里完成常见的 agent、workspace、session 管理和日常对话，不把用户卡在手写 JSON 配置上。

## 当前状态

当前已经可用的主路径：

- 微信里注册常见 agent 模板
- 微信里创建/删除 workspace
- 微信里创建 session
- 普通消息发送到当前 session
- `/status`、`/ss`、`/stop`
- `acpx` 默认优先使用项目内依赖，不要求全局安装

- [docs/testing.md](docs/testing.md)
- [docs/config-reference.md](docs/config-reference.md) — 配置文件各字段详解

## 你需要准备什么

至少需要：

- Bun
- Node.js
- 一个可用的微信登录环境
- 本机可以运行 `acpx` 及其目标 agent

本仓库已经内置这些关键依赖：

- `acpx`
- `weixin-agent-sdk`

所以正常情况下，不需要再全局安装 `acpx`。

## 安装

如果你是首次拉代码：

```bash
bun install
```

本地直接运行可用：

```bash
bun run build
node ./dist/cli.js status
```

发布后，CLI 入口是：

```bash
# 登录微信
weacpx login
# 启动后台服务
weacpx start
# 检查服务状态
weacpx status
# 停止后台服务
weacpx stop
```

## 测试命令

默认单元测试：

```bash
npm test
```

显式执行 unit tests：

```bash
npm run test:unit
```

执行 smoke tests：

```bash
npm run test:smoke
```

构建：

```bash
bun run build
```

本地 daemon CLI 烟测：

```bash
node ./dist/cli.js start
node ./dist/cli.js status
node ./dist/cli.js stop
```

测试布局和放置规则见：

- [docs/testing.md](docs/testing.md)

## 运行文件

默认使用：

- 配置文件：`~/.weacpx/config.json`
- 状态文件：`~/.weacpx/state.json`

你可以从 [config.example.json](./config.example.json) 开始。

常用环境变量：

- `WEACPX_CONFIG`
- `WEACPX_STATE`
- `WEACPX_WEIXIN_SDK`

## weixin-agent-sdk 解析顺序

运行时会按这个顺序加载微信 SDK：

1. `WEACPX_WEIXIN_SDK`
2. 已安装包 `weixin-agent-sdk`

正常情况下直接安装依赖即可。只有你想强制指向一个本地 SDK 入口文件时，才需要设置 `WEACPX_WEIXIN_SDK`。

## acpx 解析顺序

运行时会按这个顺序决定使用哪个 `acpx`：

1. `transport.command`
2. 当前项目内安装的 `acpx`
3. Shell `PATH` 里的 `acpx`

也就是说：

- 默认不需要全局安装 `acpx`
- 只有你想显式覆盖时，才需要在配置里写 `transport.command`

## 最小配置

最小可用配置通常像这样：

```json
{
  "transport": {
    "type": "acpx-bridge"
  },
  "agents": {},
  "workspaces": {}
}
```

说明：

- `transport.type` 省略时默认也是 `acpx-bridge`
- `agents` 和 `workspaces` 可以先留空，后面在微信里创建

如果你想显式指定 transport：

```json
{
  "transport": {
    "type": "acpx-cli",
    "sessionInitTimeoutMs": 120000
  },
  "agents": {},
  "workspaces": {}
}
```

## 快速开始

第一次建议按这个顺序：

1. 运行登录
2. 启动服务
3. 在微信里创建资源并开聊

命令如下：

```bash
weacpx login
weacpx start
weacpx status
```

微信ClawBot 上直接输入：

```bash
/ss codex -d /absolute/path/to/backend
# 等待初始化完成，你就能直接发消息了
```

如果你还在仓库里本地开发，也可以继续用：

```bash
bun run login
bun run dev
```

`weacpx login` 和 `bun run login` 都会在终端里直接显示二维码。

## CLI 命令

- `weacpx login`
- `weacpx run`
- `weacpx start`
- `weacpx status`
- `weacpx stop`

说明：

- `run` 前台运行，适合调试
- `start` 后台启动
- `status` 查看后台状态、pid、配置路径和日志路径
- `stop` 停止后台实例

后台运行时会使用：

- `~/.weacpx/runtime/daemon.pid`
- `~/.weacpx/runtime/status.json`
- `~/.weacpx/runtime/stdout.log`
- `~/.weacpx/runtime/stderr.log`

## 微信里的推荐上手流程

启动后，在微信里按这个顺序发：

```text
/agent add codex
/ss codex -d /absolute/path/to/your/repo
/status
```

然后直接发普通消息：

```text
hello
```

普通文本会默认发送给当前选中的 session。

## 微信命令

### Agent

增加 Agent，已内置 claude code 与 codex, 你可以通过此命令增加想要控制的 agent。
- `/agents` 
- `/agent add codex`
- `/agent add claude`
- `/agent rm <name>`

当前内置模板：

- `codex` -> `driver: "codex"`
- `claude` -> `driver: "claude"`

说明：

- 内置 `codex` 和 `claude` 都走 `acpx` 自己的 driver alias，不需要配置 `agent.command`
- `agent.command` 仍然保留，但只建议给自定义 agent 使用
- `transport.command` 仍然有效，用来显式指定 `acpx` 可执行文件路径

### Workspace

`workspace` 现在就是 `cwd` 的别名。

- `/workspaces` 或 `/workspace` 或 `/ws`
- `/ws new <name> -d <path>`
- `/workspace rm <name>`

说明：

- `/ws new` 会先校验路径是否存在，不存在会直接报错
- Windows 路径里如果有空格，请给 `-d` 或 `--cwd` 的值加引号，例如 `/ws new repo -d "E:\My Projects\weacpx"`

### Session

- `/sessions` 或 `/session` 或 `/ss`
- `/ss <agent> -d <path>`
- `/ss new <agent> -d <path>`
- `/ss new <alias> -a <name> --ws <name>`
- `/ss attach <alias> -a <name> --ws <name> --name <transport-session>`
- `/use <alias>`
- `/status`
- `/cancel` 或 `/stop`

说明：

- `/ss <agent> -d <path>` 是主入口：自动按目录名推导并创建或复用 workspace，再创建或复用 session
- 如果同名 workspace 已存在但对应的是另一个路径，会自动改名为 `name-2`、`name-3`
- `/ss new <agent> -d <path>` 表示强制新建 session；如果默认名已存在，会自动生成 `-2`、`-3` 后缀
- 执行结果会明确告诉你这次是“新增”还是“复用”了哪些资源

### 普通消息

- 非 `/` 开头的文本，默认发送到当前 session
- 如果当前没有选中的 session，会收到中文提示，要求先 `/ss new` 或 `/use`

## 常见工作流

### 1. 新建一个可聊天的会话

```text
/agent add codex
/ss codex -d /absolute/path/to/backend
修一下最近这个接口超时问题
```

### 2. 在同一个聊天里切换多个会话

```text
/ss new codex -d /absolute/path/to/backend
/ss new codex -d /absolute/path/to/backend
/ss
/use backend:codex
看一下接口日志
/use backend:codex-2
看一下前端报错
```

### 3. 删除不再需要的资源

```text
/agent rm claude
/workspace rm old-repo
```

## dry-run

`dry-run` 会复用同一套 router、session service、transport，只是把微信消息换成终端输入，适合本地排查。

例子：

```bash
bun run dry-run --chat-key wx:test -- \
  "/agent add codex" \
  "/ws new backend -d /absolute/path/to/backend" \
  "/ss new demo -a codex --ws backend" \
  "/status"
```

也支持多 chat key：

```bash
bun run dry-run \
  --chat-key wx:alice -- "/ss new demo -a codex --ws backend" "/status" \
  --chat-key wx:bob "/status"
```

## 如果 `/ss new` 失败

当前最常见的底层问题还是 `acpx` named session 的运行时恢复，不一定是 `weacpx` 自己的逻辑问题。

如果微信里直接创建失败，可以走这个兜底流程：

1. 本地先建一个 named session
2. 再在微信里用 `/ss attach`

例子：

```bash
./node_modules/.bin/acpx --verbose --cwd /absolute/workspace/path codex sessions new --name existing-demo
```

然后在微信里：

```text
/ss attach demo -a codex --ws backend --name existing-demo
```

如果你曾经在 `config.json` 里给 `codex` 写过旧版 `command`，当前版本会自动忽略它，仍然按 `acpx codex ...` 的内建路径运行。

## 其它文档

- 测试规范：
  [docs/testing.md](docs/testing.md)
- 配置参考：
  [docs/config-reference.md](docs/config-reference.md)
