# `/config` 命令说明

`/config` 是一个**受限的配置写入口**。

目标不是让微信变成任意 JSON 编辑器，而是：

- 允许修改一组明确支持的配置字段
- 拒绝不支持的字段
- 拒绝不存在的动态项
- 保持 `config.json` 结构稳定可校验

---

## 命令

### 查看支持修改的字段

```text
/config
```

返回当前允许通过微信修改的配置路径白名单。

### 修改配置

```text
/config set <path> <value>
```

例如：

```text
/config set wechat.replyMode final
/config set logging.level debug
/config set transport.permissionMode approve-reads
/config set workspaces.backend.description backend repo
```

---

## 当前支持的路径

固定字段：

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

动态字段：

- `agents.<name>.driver`
- `agents.<name>.command`
- `workspaces.<name>.cwd`
- `workspaces.<name>.description`

---

## 规则

### 1. 只允许白名单路径

不在上面列表里的路径，`/config set` 会直接拒绝。

例如：

```text
/config set transport.missing x
```

会返回“不支持修改这个配置路径”。

### 2. 不自动创建动态项

以下路径要求目标已经存在：

- `agents.<name>.*`
- `workspaces.<name>.*`

也就是说：

- `agents.claude.driver` 只有在 `claude` 这个 agent 已经存在时才能修改
- `workspaces.backend.cwd` 只有在 `backend` 这个 workspace 已经存在时才能修改

如果不存在，会直接报错，不会自动创建。

### 3. 按字段类型校验

不同路径会按各自类型校验。

例如：

- `wechat.replyMode` 只支持 `stream` / `final` / `verbose`
- `transport.permissionMode` 只支持 `approve-all` / `approve-reads` / `deny-all`
- `logging.maxFiles`、`logging.maxSizeBytes`、`logging.retentionDays`、`transport.sessionInitTimeoutMs` 必须是正数

### 4. 修改后会立即写回 `config.json`

`/config set` 成功后会：

1. 更新内存中的当前配置
2. 持久化到 `~/.weacpx/config.json`

所以这是**真实配置修改**，不是临时会话状态。

---

## 与其它命令的关系

`/config` 不是为了替代现有高层命令。

- `agent` / `workspace` 的创建和删除，仍然优先用：
  - `/agent add`
  - `/agent rm`
  - `/ws new`
  - `/workspace rm`
- `/replymode` 改的是**当前逻辑会话覆盖**
- `wechat.replyMode` 改的是**全局默认值**

也就是说：

- `/config set wechat.replyMode final`：改全局默认
- `/replymode final`：只改当前逻辑会话

---

## 设计边界

这个命令故意**不支持任意深度 JSON 修改**。

原因很简单：

1. `config.json` 里既有固定字段，也有 `agents/workspaces` 这种动态 map
2. 如果完全开放任意路径写入，很容易把配置写坏
3. weacpx 的目标是“远程可控”，不是“远程手写配置文件”

所以 `/config` 的原则是：

- 只开放高频且可安全校验的字段
- 其余字段保持显式实现

