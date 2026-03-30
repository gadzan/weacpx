# Changelog

## [0.1.5] - 2026-03-30

### Added

- ✨ **新增会话重置功能：** 引入了 `/session reset` 指令（及快捷别名 `/clear`），用于重置当前会话上下文，但保留当前的逻辑会话名称（alias）、智能体（agent）和工作区（workspace）。
- 🛑 **完善优雅退出机制：** 在控制台运行入口 (`runConsole`) 中添加了对 `SIGINT` 和 `SIGTERM` 信号的监听，通过 `AbortController` 通知 SDK 优雅关闭。
- ⏳ **守护进程关闭等待：** `DaemonController` 新增了停止守护进程时的轮询等待与超时机制，避免遗留僵尸进程或运行时文件清理不彻底。

## [0.1.4] - 2026-03-30

### Added

- 内置微信接入实现，不再依赖外部 `weixin-agent-sdk` 包完成运行时加载；仓库内新增登录、鉴权、消息收发、媒体处理、监控与存储相关模块。
- 新增微信二维码登录流程与本地账号凭证管理，包括账号索引、按账号保存凭证、登录状态检测，以及清理本机微信凭证的能力。
- 新增 `weacpx logout` CLI 命令；微信侧也增加 `/logout` 与 `/clear` 内置指令。
- 新增微信消息媒体链路，支持处理图片、视频、文件与语音消息，并支持将 Agent 返回的媒体文件回传到微信。
- 新增微信输入中间态与流式回复支持，长任务执行时可分段回传 Agent 的中间输出，而不是只在结束后返回最终结果。
- 新增权限策略命令：`/pm`、`/permission`、`/pm set allow|read|deny`、`/pm auto allow|deny|fail`。

### Changed

- `acpx-cli` 与 `acpx-bridge` 两种 transport 现在都会传递权限模式参数，支持 `approve-all`、`approve-reads`、`deny-all` 以及非交互权限策略。
- 命令路由与 transport 提示链路已调整为支持流式回调，微信端可以接收 prompt 的阶段性输出。
- 配置模型扩展了 `transport.permissionMode` 与 `transport.nonInteractivePermissions`，并补充默认值与校验逻辑。
- `runConsole` 在启动微信通道前会自动检查登录状态；未登录时会触发扫码登录。
- prompt 异常处理增强，bridge/client/router 现在会保留并记录更完整的退出码、stdout/stderr 与 NDJSON 诊断信息。
- 发布元数据调整：`package.json` 增加 `publishConfig.registry`、`engines.node >= 22`，并收敛发布文件列表。

### Docs

- 更新 `README.md`，补充了 `login`/`logout` 用法、权限策略命令、微信内置指令、Transport 权限配置，以及流式回复行为说明。
