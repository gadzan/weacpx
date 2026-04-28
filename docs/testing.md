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
npx tsc --noEmit
node ./scripts/run-tests.mjs
```

默认先执行 TypeScript 类型检查，再递归执行 `tests/unit/**/*.test.ts`。

### 显式运行 unit tests

```bash
npm run test:unit
```

同样会先执行：

```bash
npx tsc --noEmit
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

## 会话创建体验（Smoke）

### 平台包缺失自愈

复现：
1. 删除 opencode 安装目录下的 `node_modules/opencode-windows-x64`。
2. 在微信中执行 `/ss opencode --ws weacpx`。
3. 预期消息序列：
   - 🚀 正在启动 `opencode`…
   - 📦 检测到缺失依赖 `opencode-windows-x64`，正在自动安装…
   - 🔄 安装完成，正在验证会话启动…
   - 🚀 正在启动 `opencode`…（验证阶段的全新进度，计时从 0 开始）
   - 🔧 `opencode` 初始化中…（已等待 Ns）（仅长耗时时）
   - ✅ 会话已创建：...

### 自愈失败

两类失败：

- **npm 安装失败**（断网、权限等）：自动尝试精确（每个候选父包路径各一次，覆盖 Bun/npm/pnpm/yarn 全局与本地 node_modules）与全局共 N 次安装都非零退出。最终消息标题为 `❌ 自动安装失败`，列出每次 stderr 摘要（精确步骤会标注具体路径）、手动命令 `npm install -g <pkg>`、日志路径。
- **安装成功但验证仍失败**（精确安装落在错误的依赖树上、资源已被 acpx 缓存）：安装 exit=0 但重新 ensureSession 仍抛缺失依赖。最终消息标题为 `⚠️ 自动安装已执行但未能修复会话启动问题`，每个步骤显示"安装已执行但验证失败（精确 / <path>｜全局）"，同样附手动命令与日志路径。
- **跨包管理器发现**：weacpx 在自动安装前会枚举候选父包目录——Bridge 报告的 seed、`require.resolve` 能看到的本地 node_modules、`$BUN_INSTALL`/`~/.bun/install/global/node_modules`、以及 `npm root -g` / `pnpm root -g` / `yarn global dir`。存在 `package.json` 的目录依次作为 "精确" 安装步骤。

### 仅进度反馈

在无错场景下，`/ss <agent>`：
- < 3s：只看到 🚀 正在启动
- ≥ 3s：🚀 后再见 🔧 初始化中…（已等待 Ns）
