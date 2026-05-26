# 接入本地 Agent 原生会话（/ssn）

> README 只保留基础入口；本文说明 `/ssn` / `/ss native` 的完整语义、使用流程和排障。完整命令速查见 [commands.md](./commands.md)。

## 一句话说明

`/ssn` 用来把本机上 Codex 等 Agent 已有的**原生会话**接到 weacpx 里。接入后，你在微信、飞书或元宝里继续发普通消息，消息会继续进入同一个 Agent 原生会话，而不是复制出一份新上下文。

日常记这两类命令即可：

```text
/ss codex --ws project       # 创建或复用 weacpx 逻辑会话
/ssn codex --ws project      # 查询并接入本地 Codex 原生会话
```

## 什么时候用 `/ss`，什么时候用 `/ssn`

| 场景 | 推荐命令 |
|------|----------|
| 从手机新开一个远程工作会话 | `/ss codex -d /path/to/repo` |
| 切回已有 weacpx 会话 | `/ss` 然后 `/use <alias>` |
| 接入本地 Codex/Agent CLI 里已经存在的原生会话 | `/ssn codex -d /path/to/repo` |
| 列出当前会话同 agent、同 workspace 下的本地原生会话 | `/ssn` |
| 已知道原生 `sessionId`，想直接挂进 weacpx | `/ssn attach <sessionId> -a <alias>` |

`/ss` 不会主动枚举或接入新的原生会话；它只管理 weacpx 逻辑会话。不过，如果某个 weacpx 逻辑会话本身是之前通过 `/ssn` 接入的，后续 `/ss codex --ws project` 可以像复用普通会话一样切回它。

## 前置条件

- 本机使用的 `acpx` 版本需要支持 agent-side session 查询与恢复。
- 对应 Agent 也要支持原生会话列表/恢复；如果 Agent 不支持，weacpx 会提示继续使用 `/ss`。
- 如果使用 `--ws <name>`，该 workspace 需要已经在 weacpx 配置里存在；也可以直接用 `-d /absolute/path`。

## 常用流程

### 1. 按 workspace 查询并自动接入

```text
/ssn codex --ws project
```

如果只找到一个候选，weacpx 会直接接入并切换到该会话。默认别名是：

```text
<workspace>:<agent>
```

例如 `project:codex`。如果这个别名或对应的底层 transport session 名已经被占用，weacpx 会自动追加 `-2`、`-3`，避免覆盖已有会话。

### 2. 多个候选时先选编号

```text
/ssn codex --ws project
/ssn 1
```

第一次命令会列出候选并缓存一个短时间列表；`/ssn 1`、`/ssn 2` 会选择最近一次列表里的对应项。如果列表过期或被新的查询覆盖，请重新执行 `/ssn ...`。

### 3. 直接按路径查询

```text
/ssn codex -d /Users/me/project
```

这适合还没注册 workspace 的项目。weacpx 会按路径解析或创建内部工作区上下文，并把接入后的逻辑会话绑定到该路径。

### 4. 直接按原生 sessionId 接入

```text
/ssn attach 019e5d48 -a fix-ci
```

这会按最近一次 `/ssn` 查询的上下文接入指定 `sessionId`，并把 weacpx 逻辑会话别名设为 `fix-ci`。如果还没有上下文，请先执行一次：

```text
/ssn codex --ws project
```

长写法等价：

```text
/ss attach native 019e5d48 -a fix-ci
```

### 5. 查看更多或跨 cwd 查询

默认 `/ssn codex --ws project` 只看该工作目录下的原生会话。需要跨 cwd 查询时，加 `--all`：

```text
/ssn codex --ws project --all
```

如果底层返回分页，列表末尾会给出“更多”命令，直接复制发送即可。

## 接入后的行为

接入成功后，weacpx 会创建一个逻辑会话来指向这个原生会话：

- 普通消息会继续发送到同一个 Agent 原生 session。
- `/use <alias>`、`/sessions`、`/status` 等仍按 weacpx 逻辑会话工作。
- `/session rm <alias>` 只删除 weacpx 里的逻辑映射，不等于删除 Agent 原生会话。
- 同一个原生 session 再次被 `/ssn` 选中时，weacpx 会优先切回已经接入的逻辑会话，避免重复创建。

## 命令速查

| 命令 | 说明 |
|------|------|
| `/ssn` | 使用当前 weacpx 会话上下文查看本地原生会话 |
| `/ssn codex --ws project` | 查询指定 workspace 下的 Codex 原生会话 |
| `/ssn codex -d /Users/me/project` | 按本机绝对路径查询 |
| `/ssn codex --ws project --all` | 跨 cwd 查询该 agent 的原生会话 |
| `/ssn 1` | 接入或切换到列表第 1 个候选 |
| `/ssn attach <sessionId> -a <alias>` | 按原生 sessionId 接入并指定 weacpx 别名 |
| `/ss attach native <sessionId> -a <alias>` | `/ssn attach` 的长写法 |
| `/help ssn` | 在聊天里查看精简帮助 |

## 常见问题

### `/ssn` 和 `/ss native` 是什么关系？

`/ssn` 是推荐短命令；`/ss native ...` 是同一能力的显式写法。日常使用优先记 `/ssn`。

### `/ssn codex` 为什么没有自动接入唯一候选？

只写 agent 时，范围不够明确，weacpx 会展示列表而不是自动接入。想自动接入唯一候选，请显式指定 workspace 或路径：

```text
/ssn codex --ws project
/ssn codex -d /Users/me/project
```

### 为什么提示“当前 transport 不支持列出本地会话”？

说明当前 transport、`acpx` 或 Agent 暂时不能查询原生会话。你仍然可以使用 `/ss codex -d /path/to/repo` 管理普通 weacpx 会话。

### 接入失败会影响原来的 weacpx 会话吗？

weacpx 会在接入前检查 alias 和底层 transport session 名，尽量避免覆盖已有映射。如果冲突，会自动分配后缀别名，例如 `project:codex-2`。

### 在手机里聊了几轮，本地 Agent 原生会话会有这些记录吗？

会。`/ssn` 是恢复并继续同一个 Agent 原生 session，不是只复制上下文再开一个 weacpx 私有副本。具体能否在本地 CLI 中看到完整记录，取决于该 Agent 自己的 session 展示能力。
