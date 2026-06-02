# 测试

## 测试命令

运行完整的默认测试套件（TypeScript 类型检查 + 所有单元测试）：

```bash
npm test
```

等同于：

```bash
npx tsc --noEmit
node ./scripts/run-tests.mjs
```

显式运行单元测试（与 `npm test` 行为相同）：

```bash
npm run test:unit
```

运行冒烟测试（需要真实环境，详见[冒烟测试](#冒烟测试)）：

```bash
npm run test:smoke
```

构建 CLI（用于构建验证，以及运行冒烟测试前的准备）：

```bash
bun run build
```

本地试运行（无需微信账号或凭据）：

```bash
bun run dry-run --chat-key wx:test -- "/status"
```

传入多条命令以模拟对话序列：

```bash
bun run dry-run --chat-key wx:test -- "/session new demo --agent codex --ws backend" "/status"
```

## 单元测试

单元测试位于 `tests/unit/`，目录结构与 `src/` 保持镜像。其特点为：

- 稳定且可重复
- 无外部环境依赖（不依赖真实 `acpx`、不需要真实微信登录、不需要网络）
- 由 `npm test` 和 `npm run test:unit` 均可运行

测试文件遵循 `*.test.ts` 命名约定。

`npm test` 会在测试前先执行 TypeScript 类型检查（`npx tsc --noEmit`）。若类型检查失败，测试不会运行。

**新增单元测试的规范：**

1. 将新测试放在 `tests/unit/` 中，目录结构与被测代码的 `src/` 子目录保持镜像。
2. 测试文件命名为 `*.test.ts`。
3. 不要将临时调试脚本放在仓库根目录。
4. 不要将真实环境测试放入单元测试套件。

## 冒烟测试

冒烟测试位于 `tests/smoke/`，不包含在默认的 `npm test` 运行中。它们用于验证真实环境下的行为，可能需要：

- 真实的 `acpx` 会话
- 真实的 bridge 子进程
- 真实的微信登录流程或实时聊天频道
- 外部网络访问、本地 agent 运行时，或扫码操作

配置好所需环境后，单独运行冒烟测试：

```bash
npm run test:smoke
```

**不要将冒烟测试纳入默认套件。** 不同机器和 CI runner 的环境差异使其不适合作为自动门禁。

## 本地试运行

试运行模式无需任何外部凭据即可模拟聊天对话，是开发过程中验证命令路由、会话状态逻辑和响应格式的最快方式：

```bash
bun run dry-run --chat-key wx:test -- "/status"
bun run dry-run --chat-key wx:test -- "/session new demo --agent codex --ws backend" "/status"
```

`--` 后的每个字符串作为独立的聊天消息按顺序发送。`--chat-key wx:test` 标识模拟的聊天上下文。

## 测试目录结构

```text
tests/
  unit/         默认测试套件；镜像 src/ 目录结构
  integration/  保留用于跨模块测试（尚未强制执行）
  smoke/        真实环境测试；不包含在默认运行中
  helpers/      共享测试工具、fixture 构建器及仅测试用的工具
scripts/
  run-tests.mjs npm test 调用的测试运行器
src/            仅生产代码——不放测试文件
```

**`tests/integration/`** 保留用于明确依赖多个模块跨边界协作、不适合放入 `tests/unit/` 的测试，目前尚未强制执行。

**`tests/helpers/`** 存放共享工具和 fixture 构建器。小型辅助函数可以内联在单个测试文件中；当多个文件需要复用时再提取到 `tests/helpers/`。

未来新增测试类型时，请在 `tests/` 下新建子目录，而不是将测试文件放回 `src/`。
