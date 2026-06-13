# 自托管 Relay Hub — 部署运维速查

> 这是面向运维者的精简 runbook。完整图文指南（架构、TLS/反向代理、systemd、备份、故障排查）见文档站点
> **[自托管 Relay Hub](https://gadzan.github.io/xacpx/zh/guide/relay-self-hosting)**（英文版 `/guide/relay-self-hosting`）。
> 模块内部实现见 [relay-module.md](relay-module.md) / [relay-web-module.md](relay-web-module.md)。

## 现状：从源码部署

`@ganglion/xacpx-relay` / `channel-relay` / `relay-protocol` / `relay-web` 四个包**尚未发布到 npm**（均 0.1.0）。
当前从仓库 checkout 构建运行；发布后 `xacpx-relay` 命令与 `xacpx plugin add @ganglion/xacpx-channel-relay` 即一行安装。

## 端到端

```bash
# 1. 构建（服务端 + 看板，看板必须单独构建，未含在 build:packages 内）
git clone https://github.com/gadzan/xacpx && cd xacpx && bun install
bun run build:relay         # → packages/relay/dist
bun run build:relay-web     # → packages/relay-web/dist（不构建则没有 Web UI）

# 2. 建首个管理员（不带 --password 会自动生成并只打印一次；--db 用绝对路径）
node packages/relay/dist/cli.js init-admin --username admin --db /var/lib/xacpx-relay/relay.db

# 3. 起服务（--web-root 指向已构建的看板，否则无 UI）
node packages/relay/dist/cli.js start \
  --db /var/lib/xacpx-relay/relay.db \
  --web-root /opt/xacpx/packages/relay-web/dist \
  --host 0.0.0.0 --http-port 8787 --ws-port 8788 --history-retention-days 30

# 4. 发配对令牌（单次使用、--ttl-minutes 默认 10 分钟）
node packages/relay/dist/cli.js token new --account admin --name home-pc --db /var/lib/xacpx-relay/relay.db

# 5. 实例侧接入（--url 指向 8788 实例网关或其 wss:// 代理）
xacpx channel add relay --url wss://relay.example.com --token <配对令牌> --name home-pc
xacpx restart
```

## 关键事实

- **双端口**：8787 = HTTP API + 看板 + 看板 `/ws`；8788 = 实例网关（实例在此注册）。两者分开便于分别防火墙。生产经反代终结 TLS，实例用 `wss://`。
- **`xacpx-relay` CLI 只有三个子命令**：`start` / `init-admin` / `token new`。**没有 `stop`/`status`**——用 `Ctrl-C`/`SIGTERM`（建议 systemd/pm2/Docker 托管）。
- **持久化**：全部在单个 SQLite 文件（`--db`）。默认 `./relay.db` 是 **cwd 相对路径**（坑），务必用绝对路径。备份即停机/静默期 `cp` 该文件。
- **凭证**：实例首连用一次性配对令牌换长期凭证，写入 `<xacpx-home>/relay/credential.json`（0600），不进 `config.json`。
- **自动 GC**：每小时清理超 `--history-retention-days`（默认 30，另每会话硬上限 2000 条）的缓存消息，以及过期的 web 会话/邀请/配对令牌。
- **多租户**：账号只见自己的实例/会话；服务端盖戳身份；密钥一律哈希存储。邀请令牌在看板 Settings 页生成（单次使用）。
