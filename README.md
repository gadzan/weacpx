# Weacpx

连接微信与 acpx 协议，让 Claude Code / Codex 成为你口袋里的 24/7 伙伴。

[![npm](https://img.shields.io/npm/v/weacpx?style=flat-square)](https://www.npmjs.com/package/weacpx)
[![Node.js Version](https://img.shields.io/node/v/weacpx?style=flat-square)](https://nodejs.org)
[![zread](https://img.shields.io/badge/Ask_Zread-_.svg?style=flat-square&color=00b0aa&labelColor=000000&logo=data%3Aimage%2Fsvg%2Bxml%3Bbase64%2CPHN2ZyB3aWR0aD0iMTYiIGhlaWdodD0iMTYiIHZpZXdCb3g9IjAgMCAxNiAxNiIgZmlsbD0ibm9uZSIgeG1sbnM9Imh0dHA6Ly93d3cudzMub3JnLzIwMDAvc3ZnIj4KPHBhdGggZD0iTTQuOTYxNTYgMS42MDAxSDIuMjQxNTZDMS44ODgxIDEuNjAwMSAxLjYwMTU2IDEuODg2NjQgMS42MDE1NiAyLjI0MDFWNC45NjAxQzEuNjAxNTYgNS4zMTM1NiAxLjg4ODEgNS42MDAxIDIuMjQxNTYgNS42MDAxSDQuOTYxNTZDNS4zMTUwMiA1LjYwMDEgNS42MDE1NiA1LjMxMzU2IDUuNjAxNTYgNC45NjAxVjIuMjQwMUM1LjYwMTU2IDEuODg2NjQgNS4zMTUwMiAxLjYwMDEgNC45NjE1NiAxLjYwMDFaIiBmaWxsPSIjZmZmIi8%2BCjxwYXRoIGQ9Ik00Ljk2MTU2IDEwLjM5OTlIMi4yNDE1NkMxLjg4ODEgMTAuMzk5OSAxLjYwMTU2IDEwLjY4NjQgMS42MDE1NiAxMS4wMzk5VjEzLjc1OTlDMS42MDE1NiAxNC4xMTM0IDEuODg4MSAxNC4zOTk5IDIuMjQxNTYgMTQuMzk5OUg0Ljk2MTU2QzUuMzE1MDIgMTQuMzk5OSA1LjYwMTU2IDE0LjExMzQgNS42MDE1NiAxMy43NTk5VjExLjAzOTlDNS42MDE1NiAxMC42ODY0IDUuMzE1MDIgMTAuMzk5OSA0Ljk2MTU2IDEwLjM5OTlaIiBmaWxsPSIjZmZmIi8%2BCjxwYXRoIGQ9Ik0xMy43NTg0IDEuNjAwMUgxMS4wMzg0QzEwLjY4NSAxLjYwMDEgMTAuMzk4NCAxLjg4NjY0IDEwLjM5ODQgMi4yNDAxVjQuOTYwMUMxMC4zOTg0IDUuMzEzNTYgMTAuNjg1IDUuNjAwMSAxMS4wMzg0IDUuNjAwMUgxMy43NTg0QzE0LjExMTkgNS42MDAxIDE0LjM5ODQgNS4zMTM1NiAxNC4zOTg0IDQuOTYwMVYyLjI0MDFDMTQuMzk4NCAxLjg4NjY0IDE0LjExMTkgMS42MDAxIDEzLjc1ODQgMS42MDAxWiIgZmlsbD0iI2ZmZiIvPgo8cGF0aCBkPSJNNCAxMkwxMiA0TDQgMTJaIiBmaWxsPSIjZmZmIi8%2BCjxwYXRoIGQ9Ik00IDEyTDEyIDQiIHN0cm9rZT0iI2ZmZiIgc3Ryb2tlLXdpZHRoPSIxLjUiIHN0cm9rZS1saW5lY2FwPSJyb3VuZCIvPgo8L3N2Zz4K&logoColor=ffffff)](https://zread.ai/gadzan/weacpx)
[![License](https://img.shields.io/npm/l/weacpx?style=flat-square)](./LICENSE)

![weacpx logo](assets/weacpx.jpg)

## Why Weacpx？

在 Agent-First 的开发模式下，编码任务必须依托顶级 Agents，🙅‍♀️不要通过 openclaw 去开发，现在有一个更好的方案。Weacpx 通过微信提供一个轻量化的远程入口，随时随地通过手机驱动你的顶级 Agents。

Weacpx 的核心价值主张很简单：

**随时随地访问** — 只要你有微信，就能控制你的 Agent。无需 VPN、Web 界面或复杂的云服务配置。

**统一的会话管理** — 通过 acpx 协议，weacpx 让你在微信里管理多个 Agent 会话（Codex、Claude Code 等），就像在本地终端一样。创建、切换、查询状态，全部通过简单的斜杠命令完成，这是其它简单基于 ACP 实现的远控 agent 所不具备的。

**轻量守护进程** — weacpx 作为后台守护进程运行，资源占用极低。不用启动一个臃肿 openclaw，不用担心在工作机器上使用会占用资源。启动、停止、查看状态都通过简单的 CLI 命令完成。

**权限可控** — 可以即时通过微信修改 agent 的权限，无论是 YOLO 还是只读。

## 安装前准备

开始前，至少需要：

- Node.js 22+ 或 Bun
- Claude Code 或 Codex
- 装了微信的手机

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
| `/mode` | 查看当前会话已保存的 mode |
| `/mode <id>` | 设置当前会话 mode，例如 `/mode plan` |
| `/session reset` | 重置当前会话上下文，保留 alias/agent/workspace，但重新绑定到一个新的后端 session |
| `/clear` | `/session reset` 的快捷别名 |
| `/cancel` | 取消当前会话 |
| `/stop` | `/cancel` 的别名，用于取消当前会话 |

说明：

- `/ss <agent> -d <path>` 是最常用入口，会自动按目录名推导并创建或复用 workspace，再创建或复用 session
- `/ss new <agent> -d <path>` 表示强制新建 session
- `/use <alias>` 用来切换当前会话
- `/mode` 会显示当前逻辑会话里保存的 mode；如果还没设置过，会显示“未设置”
- `/mode <id>` 会把 mode 透传给底层 `acpx set-mode`，成功后再写回当前逻辑会话
- `/session reset` 和 `/clear` 会保留当前逻辑会话名，但重新创建一个新的后端 session，从空上下文重新开始
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
| `/clear` | 重置当前聊天绑定的会话上下文，效果等同于 `/session reset` |
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

### Adapter mode 参考

`acpx set-mode` / 计划中的 `/mode <id>` 本质上都是给底层 ACP session 发送 `session/set_mode`。
这里的 `<id>` 不是 `weacpx` 或 `acpx` 统一规定的枚举，而是**各 adapter 自己定义**的值；填错时通常会收到 adapter 返回的 `Invalid params` 一类错误。

基于 `acpx` 内置 adapter 文档和各上游公开文档，当前能确认的信息如下：

| adapter | 已确认可用的 mode id | 说明 |
|------|------|------|
| `codex` | `plan` | `acpx` 自身示例明确使用过 `acpx codex set-mode plan`。`codex-acp` 还暴露了 `mode` 运行时配置项，但上游目前没有公开一份完整、稳定的 mode id 列表。 |
| `cursor` | `agent`、`plan`、`ask` | Cursor 官方文档/更新日志公开提到 `Plan mode`、`Ask mode`；Cursor 官方论坛在 ACP `session/configure` 示例中展示过 `availableModes` 为 `agent` / `plan` / `ask`。 |
| 其他内置 adapter | 暂无公开、稳定的 mode id 列表 | 包括 `claude`、`copilot`、`gemini`、`qoder`、`qwen`、`kimi`、`kiro`、`iflow`、`opencode`、`trae`、`droid`、`kilocode` 等。即使某些产品本身有“Ask / Agent / Plan”之类概念，其 ACP `set-mode` 可接受的精确字符串也往往没有在官方文档中写死。 |

建议：

- 对 `codex`，优先把 `plan` 当作已知可用值。
- 对 `cursor`，优先使用 `agent`、`plan`、`ask`。
- 对其他 adapter，不要在 `weacpx` 里写死候选值；最好把 `/mode <id>` 设计成透传，由 adapter 自己决定是否接受。
- 如果某个 adapter 后续补充了官方 mode 文档，再把它们补进这里。

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
