# 微信命令参考

这篇文档列出你可以在微信里发送给 `weacpx` 的命令。README 只保留常用入口；如果你想查完整命令、别名和参数格式，看这篇。

## 阅读约定

- `<value>` 表示必填参数，例如 `<agent>`。
- `a | b` 表示二选一。
- 命令支持用引号包住带空格的值，例如 `/ws new backend -d "/Users/me/my repo"`。
- 非 `/` 开头的文本不是命令，会直接发送到当前会话。
- `/ss` 是 `/session` 的别名，`/ws` 是 `/workspace` 的别名，`/pm` 是 `/permission` 的别名，`/stop` 是 `/cancel` 的别名。

## 快速索引

| 你想做什么 | 命令入口 |
|------------|----------|
| 查看帮助 | `/help`、`/help <topic>` |
| 管理 agent | `/agents`、`/agent ...` |
| 管理工作区 | `/workspaces`、`/workspace ...`、`/ws ...` |
| 管理会话 | `/sessions`、`/session ...`、`/ss ...`、`/use ...` |
| 调整回复方式 | `/replymode ...` |
| 调整 acpx mode | `/mode ...` |
| 取消当前任务 | `/cancel`、`/stop` |
| 修改配置 | `/config ...` |
| 修改权限策略 | `/permission ...`、`/pm ...` |
| 委派子任务 | `/delegate ...`、`/dg ...` |
| 管理任务组 | `/groups`、`/group ...` |
| 管理编排任务 | `/tasks`、`/task ...` |

## 帮助

| 命令 | 说明 |
|------|------|
| `/help` | 查看帮助主题列表和常用入口 |
| `/help <topic>` | 查看某个主题的命令说明 |

常用主题包括：`agent`、`workspace`、`session`、`replymode`、`mode`、`status`、`cancel`、`config`、`permission`、`orchestration`。

示例：

```text
/help
/help ss
/help pm
/help orchestration
```

## Agent 管理

Agent 是你要驱动的底层工具配置，例如 `codex`、`claude`。

| 命令 | 说明 |
|------|------|
| `/agents` | 查看已注册的 agent |
| `/agent add <codex|claude|opencode|gemini>` | 添加一个内置 agent 模板 |
| `/agent rm <name>` | 删除一个 agent |

示例：

```text
/agent add codex
/agent add claude
/agents
/agent rm claude
```

## Workspace 管理

Workspace 是你电脑上的项目目录。建议使用绝对路径。

| 命令 | 说明 |
|------|------|
| `/workspaces` | 查看已注册的 workspace |
| `/workspace` / `/ws` | `/workspaces` 的常用别名 |
| `/workspace new <name> --cwd <path>` | 添加 workspace |
| `/ws new <name> -d <path>` | 添加 workspace 的短写法 |
| `/workspace rm <name>` | 删除 workspace |

示例：

```text
/ws new backend -d /Users/me/projects/backend
/workspaces
/workspace rm backend
```

## Session 会话

Session 是你在微信里操作的逻辑会话。每个会话绑定一个 agent 和一个 workspace。

### 查看、创建、切换

| 命令 | 说明 |
|------|------|
| `/sessions` | 查看会话列表 |
| `/session` / `/ss` | 查看会话列表 |
| `/ss <agent> -d <path>` | 用本地路径创建或复用会话 |
| `/ss <agent> --ws <workspace>` | 用已有 workspace 创建或复用会话 |
| `/ss new <agent> -d <path>` | 强制创建一个新会话 |
| `/ss new <agent> --ws <workspace>` | 用已有 workspace 强制创建一个新会话 |
| `/session new <alias> --agent <agent> --ws <workspace>` | 用指定别名创建会话 |
| `/session new <alias> -a <agent> --ws <workspace>` | 指定别名创建会话的短写法 |
| `/use <alias>` | 切换当前会话 |
| `/session rm <alias>` | 删除逻辑会话 |

示例：

```text
/ss codex -d /Users/me/projects/backend
/ss claude --ws backend
/ss new codex -d /Users/me/projects/frontend
/session new api-review --agent codex --ws backend
/use api-review
/session rm old-review
```

### 绑定已有底层会话

如果底层 `acpx` 会话已经存在，可以把它挂回微信里的逻辑会话。

| 命令 | 说明 |
|------|------|
| `/session attach <alias> --agent <agent> --ws <workspace> --name <transport-session>` | 绑定已有底层会话 |
| `/ss attach <alias> -a <agent> --ws <workspace> --name <transport-session>` | 短写法 |

示例：

```text
/ss attach demo -a codex --ws backend --name existing-demo
```

### 状态、重置、取消

| 命令 | 说明 |
|------|------|
| `/status` | 查看当前会话状态 |
| `/session reset` | 重置当前会话上下文 |
| `/clear` | `/session reset` 的别名 |
| `/cancel` | 取消当前会话里正在执行的任务 |
| `/stop` | `/cancel` 的别名 |

## 普通消息

只要消息不是 `/` 开头，`weacpx` 就会把它发送到当前会话。

```text
请阅读当前仓库，找出最近测试失败的根因
```

如果还没有当前会话，先执行 `/ss ...` 或 `/use ...`。

## 回复模式

回复模式控制微信里看到多少输出。

| 命令 | 说明 |
|------|------|
| `/replymode` | 查看全局默认、当前会话覆盖和实际生效值 |
| `/replymode stream` | 流式返回中间文本 |
| `/replymode verbose` | 流式返回，并显示工具调用摘要 |
| `/replymode final` | 只发送最终文本 |
| `/replymode reset` | 清除当前会话覆盖，回到全局默认 |

建议：

- 日常开发用 `stream`。
- 想看 agent 在做什么，用 `verbose`。
- 只想少收消息，用 `final`。

## acpx mode

`/mode` 直接传给底层 agent。可用值取决于你使用的 agent。

| 命令 | 说明 |
|------|------|
| `/mode` | 查看当前会话保存的 mode |
| `/mode <id>` | 设置当前会话 mode |

示例：

```text
/mode
/mode plan
```

已知常见值：

- `codex`: `plan`
- `cursor`: `agent`、`plan`、`ask`

## 配置

`/config` 只允许修改白名单里的配置项。完整配置字段说明见 [config-reference.md](./config-reference.md)，微信内配置命令说明见 [config-command.md](./config-command.md)。

| 命令 | 说明 |
|------|------|
| `/config` | 查看支持修改的配置路径 |
| `/config set <path> <value>` | 修改一个支持的配置值 |

当前支持的路径：

- `transport.type`
- `transport.command`
- `transport.sessionInitTimeoutMs`
- `transport.permissionMode`
- `transport.nonInteractivePermissions`
- `logging.level`
- `logging.maxSizeBytes`
- `logging.maxFiles`
- `logging.retentionDays`
- `wechat.replyMode`
- `agents.<name>.driver`
- `agents.<name>.command`
- `workspaces.<name>.cwd`
- `workspaces.<name>.description`

示例：

```text
/config set wechat.replyMode final
/config set logging.level debug
/config set transport.sessionInitTimeoutMs 30000
```

## 权限策略

权限策略影响底层 agent 能不能自动执行读写操作。

| 命令 | 实际配置值 | 说明 |
|------|------------|------|
| `/pm` / `/permission` | - | 查看当前权限策略 |
| `/pm set allow` | `approve-all` | 允许更多操作自动通过 |
| `/pm set read` | `approve-reads` | 自动允许读操作，写操作仍更谨慎 |
| `/pm set deny` | `deny-all` | 默认拒绝需要审批的操作 |
| `/pm auto` | - | 查看非交互权限策略 |
| `/pm auto deny` | `deny` | 非交互场景自动拒绝 |
| `/pm auto fail` | `fail` | 非交互场景直接失败 |

示例：

```text
/pm
/pm set read
/pm auto deny
```

## 多 Agent 编排

编排命令需要先有当前会话。当前会话会作为主控会话，子任务会派给其他 agent 会话执行。

如果你还不确定什么时候该用 delegate、什么时候该开 group，先看 [weacpx-group-usage-guide.md](./weacpx-group-usage-guide.md)。

### 委派单个子任务

| 命令 | 说明 |
|------|------|
| `/dg <agent> <task>` | 快速委派一个子任务 |
| `/delegate <agent> <task>` | 委派一个子任务 |
| `/delegate <agent> --role <role> <task>` | 按指定角色模板委派 |
| `/delegate <agent> --group <groupId> <task>` | 把委派任务加入已有任务组 |
| `/delegate <agent> --role <role> --group <groupId> <task>` | 同时指定角色和任务组 |

示例：

```text
/dg claude 审查当前方案的 3 个最高风险点
/delegate codex --role planner 把这个需求拆成最小实现步骤
/delegate claude --group review-batch 审查接口设计
```

### 管理任务组

Group 适合把多个相互独立的子任务并行派出去，再统一查看进展。

| 命令 | 说明 |
|------|------|
| `/group new <title>` | 创建任务组 |
| `/groups` | 查看任务组列表 |
| `/groups --status <pending|running|terminal>` | 按状态过滤任务组 |
| `/groups --stuck` | 只看疑似卡住的任务组 |
| `/groups --sort <updatedAt|createdAt>` | 设置排序字段 |
| `/groups --order <asc|desc>` | 设置排序方向 |
| `/group <id>` | 查看单个任务组详情 |
| `/group add <groupId> <agent> <task>` | 往任务组里添加子任务 |
| `/group add <groupId> <agent> --role <role> <task>` | 按角色模板往任务组里添加子任务 |
| `/group cancel <groupId>` | 取消组内所有未结束任务 |

示例：

```text
/group new review-batch
/group add review-batch claude 审查接口设计
/group add review-batch codex --role reviewer 审查测试覆盖
/groups --status running --sort updatedAt --order desc
/group review-batch
/group cancel review-batch
```

当前版本没有 `/group delete`。如果你只想停止组内未结束任务，用 `/group cancel <groupId>`；如果你想清理已结束的任务，用 `/tasks clean`。

### 管理编排任务

| 命令 | 说明 |
|------|------|
| `/tasks` | 查看当前主控会话下的任务列表 |
| `/tasks --status <state>` | 按任务状态过滤 |
| `/tasks --stuck` | 只看心跳超时的 running 任务 |
| `/tasks --sort <updatedAt|createdAt>` | 设置排序字段 |
| `/tasks --order <asc|desc>` | 设置排序方向 |
| `/tasks clean` | 清理当前主控会话下已结束的任务和无效绑定 |
| `/task <id>` | 查看单个任务详情 |
| `/task approve <id>` | 批准一个 `needs_confirmation` 任务 |
| `/task reject <id>` | 拒绝一个 `needs_confirmation` 任务 |
| `/task cancel <id>` | 取消一个任务 |

`/tasks --status` 当前支持：

- `pending`
- `needs_confirmation`
- `running`
- `completed`
- `failed`
- `cancelled`

示例：

```text
/tasks
/tasks --status running --sort updatedAt --order desc
/tasks --stuck
/task task_123
/task approve task_123
/task cancel task_456
/tasks clean
```

## 常见错误

### 命令被当成普通消息

只有已识别的 `/` 命令才会被解析。未知命令会作为普通文本发送给当前会话。

### 已识别命令返回参数错误

如果命令前缀是已识别的，例如 `/session`、`/group`、`/task`，但参数不匹配，`weacpx` 会返回命令格式错误。优先用 `/help <topic>` 查对应主题。

### 创建会话失败

优先检查三件事：

1. workspace 路径在运行 `weacpx` 的电脑上存在。
2. agent 已注册，可以用 `/agents` 查看。
3. 底层 agent 命令本身可运行。

如果已有底层会话，可以用 `/session attach ...` 绑定回来。
