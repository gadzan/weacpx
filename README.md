# weacpx

> 用微信远程驱动 Codex、Claude Code 等 acpx 会话。

[![npm](https://img.shields.io/npm/v/weacpx?style=flat-square)](https://www.npmjs.com/package/weacpx)
[![Node.js Version](https://img.shields.io/node/v/weacpx?style=flat-square)](https://nodejs.org)
[![zread](https://img.shields.io/badge/Ask_Zread-_.svg?style=flat-square&color=00b0aa&labelColor=000000&logo=data%3Aimage%2Fsvg%2Bxml%3Bbase64%2CPHN2ZyB3aWR0aD0iMTYiIGhlaWdodD0iMTYiIHZpZXdCb3g9IjAgMCAxNiAxNiIgZmlsbD0ibm9uZSIgeG1sbnM9Imh0dHA6Ly93d3cudzMub3JnLzIwMDAvc3ZnIj4KPHBhdGggZD0iTTQuOTYxNTYgMS42MDAxSDIuMjQxNTZDMS44ODgxIDEuNjAwMSAxLjYwMTU2IDEuODg2NjQgMS42MDE1NiAyLjI0MDFWNC45NjAxQzEuNjAxNTYgNS4zMTM1NiAxLjg4ODEgNS42MDAxIDIuMjQxNTYgNS42MDAxSDQuOTYxNTZDNS4zMTUwMiA1LjYwMDEgNS42MDE1NiA1LjMxMzU2IDUuNjAxNTYgNC45NjAxVjIuMjQwMUM1LjYwMTU2IDEuODg2NjQgNS4zMTUwMiAxLjYwMDEgNC45NjE1NiAxLjYwMDFaIiBmaWxsPSIjZmZmIi8%2BCjxwYXRoIGQ9Ik00Ljk2MTU2IDEwLjM5OTlIMi4yNDE1NkMxLjg4ODEgMTAuMzk5OSAxLjYwMTU2IDEwLjY4NjQgMS42MDE1NiAxMS4wMzk5VjEzLjc1OTlDMS42MDE1NiAxNC4xMTM0IDEuODg4MSAxNC4zOTk5IDIuMjQxNTYgMTQuMzk5OUg0Ljk2MTU2QzUuMzE1MDIgMTQuMzk5OSA1LjYwMTU2IDE0LjExMzQgNS42MDE1NiAxMy43NTk5VjExLjAzOTlDNS42MDE1NiAxMC42ODY0IDUuMzE1MDIgMTAuMzk5OSA0Ljk2MTU2IDEwLjM5OTlaIiBmaWxsPSIjZmZmIi8%2BCjxwYXRoIGQ9Ik0xMy43NTg0IDEuNjAwMUgxMS4wMzg0QzEwLjY4NSAxLjYwMDEgMTAuMzk4NCAxLjg4NjY0IDEwLjM5ODQgMi4yNDAxVjQuOTYwMUMxMC4zOTg0IDUuMzEzNTYgMTAuNjg1IDUuNjAwMSAxMS4wMzg0IDUuNjAwMUgxMy43NTg0QzE0LjExMTkgNS42MDAxIDE0LjM5ODQgNS42MDE1NiAxNC4zOTg0IDQuOTYwMVYyLjI0MDFDMTQuMzk4NCAxLjg4NjY0IDE0LjExMTkgMS42MDAxIDEzLjc1ODQgMS42MDAxWiIgZmlsbD0iI2ZmZiIvPgo8cGF0aCBkPSJNNCAxMkwxMiA0TDQgMTJaIiBmaWxsPSIjZmZmIi8%2BCjxwYXRoIGQ9Ik00IDEyTDEyIDQiIHN0cm9rZT0iI2ZmZiIgc3Ryb2tlLXdpZHRoPSIxLjUiIHN0cm9rZS1saW5lY2FwPSJyb3VuZCIvPgo8L3N2Zz4K&logoColor=ffffff)](https://zread.ai/gadzan/weacpx)
[![License](https://img.shields.io/npm/l/weacpx?style=flat-square)](./LICENSE)

![weacpx logo](assets/weacpx.jpg)

## 这是什么

`weacpx` 是一个可以通过微信直接控制 Codex / Claude Code / Gemini / OpenCode 的工具。它把微信消息通过 `acpx` 连接到 Agent CLI 会话上，让你直接在手机里：

- 新建和切换会话
- 让 Agent 继续在指定项目目录里工作
- 查看流式回复、最终结果和工具调用摘要
- 调整权限策略
- 在需要时做多 Agent 编排

如果你需要临时远程编码或办公，`weacpx` 提供的是一个方便快捷的**远程入口**，让你在微信里就能随时随地干活。

## 适合谁

`weacpx` 适合轻量临时使用多 Agent 办公的用户。你可以用微信盯任务、发指令、看结果，并在同一个聊天里管理多个会话。

> `weacpx` 的会话是跟本地隔离的，它目前还不能使用 CLI 已有的会话，你在 weacpx 也无法看到本地的 CLI 会话记录。

## 5 分钟快速开始

### 前置条件

开始前，你至少需要：

- Node.js 22+ 或 Bun
- 已可用的 Codex / Claude Code / Gemini / OpenCode
- 一台装了微信的手机

> `weacpx` 基于 `weixin-agent-sdk` 和 `acpx` 工作。正常情况下，你不需要额外全局安装 `acpx`。

### 安装

```bash
npm install -g weacpx --registry=https://registry.npmjs.org
# 或
bun add -g weacpx
```

### 登录微信

```bash
weacpx login
```

终端会显示二维码，请继续用微信扫码登录。

### 启动服务

```bash
weacpx start
```

### 在微信里创建第一个会话

把下面两条消息发到微信：

```text
/ss codex -d /absolute/path/to/your/repo
/help
```

然后直接发普通文本，例如：

```text
hello
```

如果一切正常，普通文本会进入当前会话，Agent 的回复会回到微信。

## 你的日常使用流程

最常见的使用顺序只有四步：

1. **启动后台服务**：`weacpx start`
2. **创建或切换会话**：`/ss ...`、`/use ...`
3. **直接发普通文本**：让当前会话继续工作
4. **必要时查看状态或取消当前任务**：`/status`、`/cancel`

### 1) 创建会话

最常用命令：

```text
/ss codex -d /absolute/path/to/your/repo
```

它会使用 `codex`，绑定这个工作目录，并自动切换到新会话。

### 2) 发普通消息

非 `/` 开头的文本，都会发送到当前会话。

```text
修一下最近这个接口超时问题
```

### 3) 看回复

`weacpx` 支持三种常用回复模式：

- `stream`：流式返回中间文本
- `final`：只返回最终结果
- `verbose`：默认，在流式文本之外，额外显示工具调用摘要

例如 `verbose` 模式下，你会看到：

```text
📖 sed -n '1,220p' README.md
🔍 rg -n 'session new' src tests
💻 bun test tests/unit/main.test.ts
✏️ Edit parse-command.ts
```

### 4) 切换会话

```text
/ss
/use backend:codex
```

这样你可以在同一个微信聊天里切换不同项目、不同 agent 的会话。

## 常用 CLI 命令

这些命令在电脑终端里运行。

| 命令 | 说明 |
|------|------|
| `weacpx login` | 登录微信 |
| `weacpx logout` | 清除本机保存的微信登录凭证 |
| `weacpx run` | 前台运行，适合调试 |
| `weacpx start` | 后台启动服务 |
| `weacpx status` | 查看后台状态、PID、配置路径、日志路径 |
| `weacpx stop` | 停止后台实例 |
| `weacpx doctor` | 运行环境诊断 |
| `weacpx version` | 查看当前版本 |

### `doctor` 怎么用

```bash
weacpx doctor
weacpx doctor --verbose
weacpx doctor --smoke
weacpx doctor --smoke --agent codex --workspace backend
```

说明：

- `--verbose` 会展开每项检查的细节
- `--smoke` 会额外执行一次真实 transport 级别的最小 prompt 检查
- `--agent` / `--workspace` 只影响 `--smoke`
- 如果不传 `--smoke`，相关检查会显示为 `SKIP`

## 常用微信命令

完整微信命令参考见：[docs/commands.md](./docs/commands.md)。

### Agent 管理

已内置常用的 Codex 与 Claude Code；

可以使用 `/agent add opencode` 添加你所需要的 agents。

| 命令 | 说明 |
|------|------|
| `/agents` | 查看 agent 列表 |
| `/agent add gemini` | 添加 `Gemini` Agent |
| `/agent add opencode` | 添加 `OpenCode` Agent |
| `/agent rm <name>` | 删除 agent |

### Workspace 管理

| 命令 | 说明 |
|------|------|
| `/workspaces` / `/workspace` / `/ws` | 查看 workspace 列表 |
| `/ws new <name> -d <path>` | 添加 workspace，`path` 是电脑上的绝对路径，Windows 不用区分正反斜杠 |
| `/workspace rm <name>` | 删除 workspace |

### Session 会话

| 命令 | 说明 |
|------|------|
| `/sessions` / `/session` / `/ss` | 查看会话列表 |
| `/ss <agent> (-d <path> \| --ws <name>)` | 创建或复用当前最常用的会话 |
| `/ss new <agent> (-d <path> \| --ws <name>)` | 强制新建会话 |
| `/use <alias>` | 切换当前会话 |
| `/status` | 查看当前会话状态 |
| `/mode` / `/mode <id>` | 查看或设置底层 `acpx` mode |
| `/replymode` | 查看当前回复模式 |
| `/replymode stream` | 流式回复 |
| `/replymode verbose` | 流式 + 工具调用摘要 |
| `/replymode final` | 只返回最终结果 |
| `/replymode reset` | 回退到全局默认 reply mode |
| `/session reset` | 重置当前会话上下文 |
| `/clear` | `/session reset` 的快捷别名 |
| `/cancel` / `/stop` | 停止当前任务 |

建议你优先记住这三个：

```text
/ss codex -d /absolute/path/to/repo
/use <alias>
/cancel
```

### 配置与权限

| 命令 | 说明 |
|------|------|
| `/config` | 查看支持通过微信修改的配置路径 |
| `/config set <path> <value>` | 修改一个白名单配置项 |
| `/pm` / `/permission` | 查看当前权限模式 |
| `/pm set allow` | 切到 `approve-all` |
| `/pm set read` | 切到 `approve-reads` |
| `/pm set deny` | 切到 `deny-all` |
| `/pm auto` | 查看当前非交互权限策略 |
| `/pm auto deny` | 切到 `deny` |
| `/pm auto fail` | 切到 `fail` |

最常见例子：

```text
/config set wechat.replyMode final
/pm set read
/pm auto deny
```

### 多 Agent 编排

README 里只保留用户视角的最常用命令。

| 命令 | 说明 |
|------|------|
| `/dg <agent> <task>` | 快速委派一个子任务 |
| `/group new <title>` | 创建任务组 |
| `/group add <groupId> <agent> <task>` | 往任务组里加子任务 |
| `/groups` | 查看任务组列表 |
| `/group <id>` | 查看单个任务组 |
| `/group cancel <groupId>` | 取消组内未结束任务 |
| `/tasks` | 查看当前主线下的任务 |
| `/task <id>` | 查看单个任务详情 |
| `/task approve <id>` | 批准 `needs_confirmation` 任务 |
| `/task cancel <id>` | 取消任务 |

最常见例子：

```text
/dg claude 审查当前方案的 3 个高风险点
/group new review
/group add review claude 审查接口设计
/tasks
/task approve task_123
```

说明：

- 当前会话就是主控会话
- 被委派出去的是独立子任务会话
- agent 发起的委派请求默认需要人工确认
- group 适合把 2~3 个独立子任务并行派出去，再把结果汇总回主线

如果你想先理解什么时候该用 delegate、什么时候该开 group，请看：

- [docs/weacpx-group-usage-guide.md](./docs/weacpx-group-usage-guide.md)

## 常见场景

### 在手机上继续盯一个本地项目

```text
/ss codex -d /absolute/path/to/backend
看一下今天这个接口超时问题
```

### 同一个聊天里切换两个项目

```text
/ss codex -d /absolute/path/to/backend
/ss new codex -d /absolute/path/to/frontend
/ss
/use backend:codex
/use frontend:codex
```

## 配置与运行文件

默认文件位置：

- 配置文件：`~/.weacpx/config.json`
- 状态文件：`~/.weacpx/state.json`
- 运行日志：`~/.weacpx/runtime/app.log`

更多运行时文件会放在 `~/.weacpx/runtime/` 下。

## 常见问题

### `/ss new` 失败怎么办？

如果你在微信里创建会话失败，最常见的情况不是 `weacpx` 命令格式错了，而是底层会话没有成功创建。

你可以先试这两步：

1. 在终端里确认当前项目目录和 agent 本身可用
2. 如果你熟悉 `acpx`，先手动创建一个会话，再在微信里挂回去

例如，你可以先在本地创建一个会话：

```bash
./node_modules/.bin/acpx --verbose --cwd /absolute/workspace/path codex sessions new --name existing-demo
```

然后在微信里把它挂回来：

```text
/ss attach demo -a codex --ws backend --name existing-demo
```

### `/mode <id>` 里的 `<id>` 是什么？

`/mode` 的可用值取决于你当前使用的 agent，`weacpx` 不会替你统一转换这些值。

当前比较明确的已知值：

- `codex`: `plan`
- `cursor`: `agent`、`plan`、`ask`

如果你不确定某个值能不能用，优先查对应 agent 的文档；如果填错，通常会直接收到无效参数之类的报错。

## 从源码运行

如果你是从仓库源码直接使用：

```bash
bun install
bun run login
bun run dev
```

## 更多文档

如果你现在要做的是下面这些事，可以直接从这里继续：

### 安装与配置

- 想看完整配置字段：[docs/config-reference.md](./docs/config-reference.md)
- 想在微信里改配置：[docs/config-command.md](./docs/config-command.md)

### 日常使用

- 想查看完整微信命令参考：[docs/commands.md](./docs/commands.md)
- 想理解什么时候该用 delegate、什么时候该开 group：[docs/weacpx-group-usage-guide.md](./docs/weacpx-group-usage-guide.md)

### 排错与验证

- 想跑测试或了解测试分层：[docs/testing.md](./docs/testing.md)

### 开发与贡献

- 想从源码开发、调试或参与贡献：[docs/developments.md](./docs/developments.md)
