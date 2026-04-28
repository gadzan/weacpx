# Weacpx Group Usage Guide

这份指南只讲一件事：**任务组什么时候该取消，什么时候该清理，什么时候可以删**。  
下面的说明和当前 `/help group` / `/help orchestration` 的命令行为保持一致。

## 先记住三个动作

| 命令 | 作用 | 是否影响运行中的任务 |
|---|---|---|
| `/group cancel <groupId>` | 停掉某个任务组里的运行中工作 | 会 |
| `/groups clean` | 批量清理当前 coordinator 主线下已经安全收尾的组壳 | 不会 |
| `/group delete <groupId>` | 针对单个安全任务组做清理 | 不会 |

一句话区分：

- **cancel**：先把活干停。
- **clean**：批量删掉已经结束、已经安全的组壳。
- **delete**：只删一个已经安全的组壳。

## `/group cancel <groupId>`

这个命令的目标不是“删除任务组”，而是**停止该组里还在跑的工作**。

它会：

- 对组内所有未结束任务发起取消
- 跳过已经结束的任务
- 保留这个任务组本身，方便你之后继续查看、收尾或做结果判断

适合这些场景：

- 发现这一组方向错了，先停掉
- 想保留上下文，但不想再继续执行
- 还不确定这组能不能删，先让它收口

## `/groups clean`

这个命令是**批量清理**，只处理当前 coordinator 主线下已经安全的组。

它会清理两类对象：

1. **空任务组**
2. **已经完成且收尾完成的任务组**

它不会去碰还在执行中的组，也不会替你取消运行中的任务。

适合这些场景：

- 你想一次性把当前主线下已经结束的“组壳”清掉
- 你不想逐个 `/group delete`
- 你只关心当前 coordinator 主线，不想跨主线动别人的组

## `/group delete <groupId>`

这个命令是**定点清理一个组**。

它只允许删除**安全任务组**，也就是：

- 空任务组
- 或者已经收尾完成、没有遗留活跃工作的任务组

删除一个安全的已完成任务组时，会同时做这些事：

- 清掉这个组的终端任务记录
- 释放现在不再使用的 worker 绑定

### 删除会被拒绝的情况

#### 情况 A：组里还有活跃任务

如果这个组里还有活跃任务，`/group delete <groupId>` 会直接拒绝。

这时正确做法是：

1. 先执行 `/group cancel <groupId>`
2. 等组内运行中任务停下来
3. 再考虑删除

#### 情况 B：任务都结束了，但收尾还没完成

如果这个组已经是终态，但 **fan-in / 注入收尾还没完成**，它也还不能删。

这时应该：

- 继续当前 coordinator 主线
- 或者等待任务组收尾完成
- 等收尾完成后再执行 `/group delete <groupId>`

## 什么时候用哪个

- **只是想停掉还在跑的工作**：用 `/group cancel <groupId>`
- **想把当前主线下已经结束的组一次性清掉**：用 `/groups clean`
- **只想删一个已经安全收尾的组**：用 `/group delete <groupId>`

## 最小决策流程

1. 这个组还在跑吗？
   - 是：先 `/group cancel <groupId>`
   - 否：继续下一步
2. 这个组已经安全收尾了吗？
   - 否：继续 coordinator 主线，等收尾完成
   - 是：可以 `/group delete <groupId>`，或者直接 `/groups clean`

## 示例

```text
/group cancel review-batch
/groups clean
/group delete review-batch
```

如果你在看 `/group` 详情时发现：

- 组里还有 running 任务：先 cancel
- 组里已经没有活任务：可以考虑 delete
- 组看起来已经结束，但还提示收尾未完成：先等收尾，再 delete
