# `src/commands` 模块说明

## 模块目标

`src/commands` 负责把微信侧收到的文本命令，转换成系统内部可执行的动作。

它只解决三件事：
- **识别命令**：把 `/session new ...`、`/agent add ...` 这类输入解析成结构化命令。
- **路由命令**：按命令类型分发到对应 handler。
- **返回结果**：把执行结果整理成统一的文本响应。

一句话：这是 **命令入口层**，不是业务存储层，也不是传输实现层。

## 在整体架构里的位置

调用链大致是：

`WeChat 消息 -> console-agent -> CommandRouter -> handler -> SessionService / SessionTransport / ConfigStore -> 文本响应`

这里的职责边界是：
- `src/commands` 负责“**用户说了什么，该调谁**”。
- `src/sessions` 负责“**逻辑会话怎么存、怎么切换**”。
- `src/transport` 负责“**怎么和 acpx 会话通信**”。
- `src/config` 负责“**Agent / workspace / transport 配置怎么读写**”。

## 目录结构

### `command-router.ts`
模块主入口。

职责：
- 调用 `parseCommand()` 解析输入。
- 基于 `command.kind` 做总分发。
- 组装 handler 所需上下文和 ops。
- 兜住传输层错误、日志和诊断信息。

可以把它理解成：**薄路由 + 上下文装配器**。

### `parse-command.ts`
命令解析器。

职责：
- 识别 slash command。
- 提取参数、选项和 prompt 文本。
- 输出统一的命令结构，供路由层消费。

它只负责“**看懂输入**”，不负责执行。

### `handlers/`
按责任拆开的命令处理器。

当前主要包括：
- `help-handler.ts`：帮助命令。
- `agent-handler.ts`：Agent 配置管理。
- `workspace-handler.ts`：workspace 配置管理。
- `permission-handler.ts`：permission 相关命令。
- `session-handler.ts`：会话主流程入口，如新建、切换、状态、prompt、cancel。
- `session-shortcut-handler.ts`：会话快捷创建/切换流程。
- `session-recovery-handler.ts`：会话恢复与错误渲染。
- `session-reset-handler.ts`：会话 reset 流程。

拆分原则不是按命令名堆文件，而是按**责任边界**拆：
- 主流程
- 快捷流程
- 恢复逻辑
- reset 逻辑
- 配置类命令

这样做的目的是降低 `command-router.ts` 和单个大 handler 的耦合。

### `router-types.ts`
路由层共享类型定义。

职责：
- 定义 `RouterResponse`。
- 定义 `CommandRouterContext`。
- 定义各类 session ops 接口，如生命周期、交互、恢复、reset、shortcut。

它的价值是把“**路由依赖什么能力**”显式化，而不是散落在各个 handler 里。

### `transport-diagnostics.ts`
传输错误诊断辅助。

职责：
- 提炼 transport 错误摘要。
- 提炼 ndjson / tail / partial output 等调试信息。
- 让路由层在报错时给出更稳定的用户提示和日志信息。

它不负责恢复，只负责**诊断信息整理**。

## 处理流程

以一条命令为例：

1. 外层把文本传给 `CommandRouter.handle()`。
2. `parseCommand()` 解析出 `kind` 和参数。
3. `command-router.ts` 按 `kind` 选择对应 handler。
4. handler 调用底层服务：
   - 会话状态走 `SessionService`
   - acpx 交互走 `SessionTransport`
   - 配置修改走 `ConfigStore`
5. handler 返回统一的 `{ text }`。
6. 外层再把文本发回微信。

## 设计原则

这个模块遵循几个原则：

- **解析和执行分离**：`parse-command.ts` 不做业务执行。
- **路由和实现分离**：`command-router.ts` 只负责分发和装配，不塞满业务细节。
- **错误恢复单独收口**：恢复逻辑放到独立 handler，而不是散在主流程里。
- **依赖能力显式化**：通过 `router-types.ts` 把 session 相关能力拆成小接口。
- **响应统一**：路由层统一返回 `RouterResponse`，方便上层消费。

## 适合放在这里的代码

适合放进 `src/commands` 的代码：
- 新的 slash command 解析规则。
- 新的命令路由分发。
- 某类命令的文本响应组织。
- 与命令执行直接相关的轻量编排逻辑。

不适合放进这里的代码：
- 会话状态持久化细节。
- acpx 进程或桥接协议细节。
- 配置文件读写细节。
- 与命令无关的通用业务逻辑。

判断标准就一句话：如果代码回答的是“**这条命令该怎么处理**”，通常属于这里；如果回答的是“**底层能力具体怎么实现**”，通常不属于这里。

## 修改建议

如果后续要继续扩展命令，建议按下面的顺序改：

1. 先在 `parse-command.ts` 定义输入形态。
2. 再新增或扩展对应 handler。
3. 最后在 `command-router.ts` 接入分发。

如果一个命令开始包含：
- 主流程
- 恢复流程
- reset/重试流程
- 专门的渲染逻辑

那就应该尽早拆成独立 handler，不要继续堆进同一个文件。
