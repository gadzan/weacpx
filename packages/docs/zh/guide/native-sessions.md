# 原生 Agent 会话

## 概述

`/ssn`（"session native" 的缩写）允许将 xacpx 附接到本地机器上已在运行的 agent 会话——例如从终端启动的 Codex 会话——而不会中断其现有上下文或对话历史。

附接成功后，你可以从手机或任意聊天频道继续同一个原生会话。你发送的消息直接进入该会话，agent 的回复会实时流回聊天。

## 会话概念

xacpx 维护两个独立的会话层：

| 层级 | 管理方 | 跟踪内容 |
|---|---|---|
| **逻辑会话** | xacpx（`SessionService`） | 别名、agent 绑定、工作区绑定、聊天上下文，以及指向的 transport 会话 |
| **原生（transport）会话** | `acpx` / agent 本身 | 实际运行的 agent 进程及其对话状态 |

大多数命令——`/ss`、`/use`、`/session rm`——操作的是逻辑会话层。`/ssn` 是将 xacpx 逻辑会话与现有原生会话关联的桥梁，而不是创建新会话。

**重要规则：** `/session rm <alias>` 只删除 xacpx 的逻辑映射，不会终止或删除底层的原生 agent 会话。

## 使用 `/ssn`

### 何时用 `/ss`，何时用 `/ssn`

| 目标 | 命令 |
|---|---|
| 从零开始创建新的远程会话 | `/ss <agent> -d /path/to/repo` |
| 切换回已有的 xacpx 会话 | `/use <alias>` |
| 附接到本地已在运行的原生 agent 会话 | `/ssn <agent> --ws <workspace>` |
| 列出当前 agent/工作区下的原生会话 | `/ssn` |
| 通过已知原生会话 ID 附接 | `/ssn attach <sessionId> -a <alias>` |

`/ss` 不会枚举或附接现有原生会话，它只管理 xacpx 逻辑会话层。通过 `/ssn` 附接后，会创建一个新的逻辑会话别名（例如 `codex-e8e552e7`），并显示在 `/ss` 列表中。之后可用 `/use <alias>` 切换回该会话。

### 列出当前上下文的原生会话

```text
/ssn
```

使用当前 xacpx 会话的 agent 和工作区上下文查询原生会话。

### 按工作区名称附接

```text
/ssn codex --ws project
```

若只找到一个匹配项，xacpx 会立即附接并切换到该会话。默认别名格式为：

```text
<agent>-<last-8-chars-of-sessionId>
```

例如：`codex-e8e552e7`。若该别名或底层 transport 会话名称已被占用，xacpx 会自动追加后缀（`-2`、`-3` 等）以避免覆盖已有会话。

### 从列表中选择

存在多个候选项时，xacpx 会显示编号列表并等待选择：

```text
/ssn codex --ws project
/ssn 1
```

`/ssn 1`、`/ssn 2` 等从最近一次列表中选择。列表在短暂时间后过期；若已过期，重新执行 `/ssn` 命令即可。

选择时指定自定义别名：

```text
/ssn 1 -a fix-ci
```

在微信中，由于列表里不显示完整会话 ID，按编号选择并指定别名比使用 `/ssn attach <sessionId> -a ...` 更实用。

### 按绝对路径附接

```text
/ssn codex -d /Users/me/project
```

当工作区尚未在 xacpx 中注册时使用此方式。xacpx 会解析或创建一个绑定到该路径的内部工作区上下文。

### 按会话 ID 附接

```text
/ssn attach 019e5d48 -a fix-ci
```

此操作使用最近一次 `/ssn` 查询的上下文。若尚无查询上下文，请先执行工作区查询：

```text
/ssn codex --ws project
```

等效的完整写法：

```text
/ss attach native 019e5d48 -a fix-ci
```

### 跨工作区查询

默认情况下，`/ssn` 按当前工作目录过滤。若要搜索指定 agent 下的所有工作区：

```text
/ssn codex --ws project --all
```

若后端返回分页结果，列表底部会显示可直接发送的继续查询命令。

## 附接与切换行为

附接成功后：

- 后续普通消息会转发到同一个原生 agent 会话。
- `/use <alias>`、`/ss`（列表）和 `/status` 均正常操作 xacpx 逻辑会话。
- 若通过 `/ssn` 再次选择同一个原生会话 ID，xacpx 会切换回已附接的逻辑会话，而不是创建重复项。

### 命令参考

| 命令 | 说明 |
|---|---|
| `/ssn` | 使用当前 xacpx 会话上下文查询原生会话 |
| `/ssn codex --ws project` | 查询指定工作区下的 Codex 原生会话 |
| `/ssn codex -d /Users/me/project` | 按本地绝对路径查询 |
| `/ssn codex --ws project --all` | 跨工作区查询该 agent 的原生会话 |
| `/ssn 1` | 附接或切换到最近列表中的第 1 个候选项 |
| `/ssn 1 -a <alias>` | 附接第 1 个候选项并指定自定义别名 |
| `/ssn attach <sessionId> -a <alias>` | 按指定会话 ID 附接并指定自定义别名 |
| `/ss attach native <sessionId> -a <alias>` | `/ssn attach` 的完整写法 |
| `/help ssn` | 在聊天中显示精简帮助信息 |

## 限制

- 本地 `acpx` 版本必须支持 agent 侧的会话查询与恢复。若不支持，xacpx 会提示改用 `/ss`。
- Agent 本身必须支持原生会话列举与恢复，并非所有 agent 都实现了此功能。
- 使用 `--ws <name>` 时，工作区必须已在 xacpx 中注册；否则请用 `-d <absolute-path>` 直接引用目录。
- `/ssn` 只查询运行 xacpx 守护进程的**本地机器**上的会话，不查询远程主机。
- 候选项编号列表有效期较短，过期后请重新执行 `/ssn` 查询。

## 故障排查

**"Current transport does not support listing native sessions"**

已安装的 `acpx` 版本或当前使用的 agent 未实现会话枚举功能。你仍然可以通过 `/ss <agent> -d /path/to/repo` 管理普通 xacpx 会话。

**`/ssn codex` 显示列表而非自动附接**

仅指定 agent 名称存在歧义。请添加工作区或路径以启用单候选自动附接：

```text
/ssn codex --ws project
/ssn codex -d /Users/me/project
```

**附接失败——会覆盖我的现有会话吗？**

不会。xacpx 在附接前会同时检查别名和底层 transport 会话名称。有冲突时会自动分配带后缀的别名（例如 `codex-e8e552e7-2`）。

**手机上的对话会出现在本地 agent 终端吗？**

会。`/ssn` 恢复的是同一个原生 agent 会话，不是副本。本地 CLI 中是否显示完整对话历史，取决于 agent 自身的会话显示能力。
