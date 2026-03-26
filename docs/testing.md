# Testing Guide

## Goal

让测试目录和执行入口保持清晰、稳定、可维护。

生产代码放在 `src/`，测试代码放在 `tests/`，不要再把测试文件散落在源码目录里。

## 目录约定

### `tests/unit/`

默认单元测试目录。

规则：

- 目录结构尽量镜像 `src/`
- 默认所有稳定、可重复、无外部环境依赖的测试都放这里
- `npm test` 和 `npm run test:unit` 都跑这里

### `tests/integration/`

为真正跨模块、跨边界的测试预留。

只有当测试明显依赖多个模块协作，并且不适合继续放在 `tests/unit/` 时，再使用这个目录。

当前仓库还没有强制启用它。

### `tests/smoke/`

放真实环境烟测脚本或需要外部依赖的验证：

- 真实 `acpx`
- 真实 bridge
- 真实微信运行链路

这些测试不应进入默认 `npm test`，避免本地或 CI 因环境差异变得不稳定。

### `tests/helpers/`

放测试辅助函数、fixture builder、测试专用工具。

当前如果某个 helper 很小，也可以先内联在测试文件里；只有复用明显时再提取。

## 默认命令

### 全量默认单元测试

```bash
npm test
```

等价于：

```bash
node ./scripts/run-tests.mjs
```

默认递归执行 `tests/unit/**/*.test.ts`。

### 显式运行 unit tests

```bash
npm run test:unit
```

### 构建验证

```bash
bun run build
```

## 新增测试时的规则

1. 新测试默认放 `tests/unit/`
2. 目录结构尽量镜像 `src/`
3. 测试文件命名保持 `*.test.ts`
4. 避免把临时排障脚本留在仓库根目录
5. 需要真实环境的验证不要塞进默认测试套件

## 什么时候放进 smoke

下列情况优先考虑 `tests/smoke/` 而不是 `tests/unit/`：

- 需要真实 `acpx` 会话
- 需要真实 `~/.acpx` 状态写入
- 需要真实微信登录
- 需要外部网络、GUI、二维码扫描或本地 agent 运行环境

## 迁移后的规则

- `src/` 只放生产代码
- `tests/` 只放测试代码
- `scripts/` 只放运行脚本，不放测试主体

如果以后需要新增测试类型，优先在 `tests/` 下新增子目录，而不是重新把测试塞回 `src/`。
