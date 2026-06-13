# 自托管 Relay Hub

**Relay Hub** 是一个可选的、自托管的服务端，它能把 xacpx 变成一个多租户的远程遥控看板。你的各个 xacpx 实例会通过 WebSocket **主动向外**拨号连接到 Hub 并注册；随后你即可从任意浏览器登录 Web 看板，在同一个地方驱动每个实例的会话——聊天、定时任务和编排。

本指南将带运维人员从零开始，搭建一个已配对实例并正常运行的 Hub。

::: warning 预发布：从源码部署
relay 相关的包（`@ganglion/xacpx-relay`、`@ganglion/xacpx-channel-relay`、`@ganglion/xacpx-relay-protocol`、`@ganglion/xacpx-relay-web`）已构建并通过审计，但**尚未发布到 npm**。在发布之前，你需要按下文所示从仓库的检出代码部署 Hub。一旦发布，`xacpx-relay` 二进制文件以及 `xacpx plugin add @ganglion/xacpx-channel-relay` 都会变成一行命令即可安装——两种路径下文均有说明。
:::

## 架构速览

```
   xacpx instance A ─┐                         ┌─ browser (account: alice)
   xacpx instance B ─┤  WSS (dial-out)         │  HTTPS + WSS
   xacpx instance C ─┴──────────────►  RELAY HUB  ◄───────────┘
                       :8788 instance gateway   :8787 HTTP API + web /ws
                                  │
                              relay.db (SQLite)
```

- **两个端口。** HTTP API 与看板的 `/ws` 广播共用 **8787**；**实例** WebSocket 网关（xacpx 实例在此注册）是 **8788**。两者相互独立，便于你分别配置防火墙策略。
- **多租户。** 每个账户永远只能看到属于自己的实例和会话；服务端会在每次代理调用上打上身份标记。各类密钥（密码、配对令牌、实例凭据、Web 会话 Cookie）均以哈希形式存储。
- **数据真相源仍在实例侧。** Hub 会为看板缓存近期消息，但它并不拥有你的会话——会话归实例所有。

## 环境要求

- **Node.js ≥ 22.13**（使用内置的 `node:sqlite`）**或 Bun ≥ 1.2**（使用 `bun:sqlite`）。无需编译原生数据库插件。
- 一台可被你的实例和浏览器访问到的主机。对于 localhost 之外的任何部署，你都需要一个负责 TLS 终止的反向代理（参见 [TLS 与反向代理](#tls-reverse-proxy)）。
- 要配对实例，每个实例都需要 `xacpx` CLI（即[快速开始](/zh/guide/getting-started)中的常规安装）。

## 1. 获取服务端

克隆仓库，构建 relay 服务端和看板：

```bash
git clone https://github.com/gadzan/xacpx
cd xacpx
bun install

# Build the hub server (compiles relay-protocol + relay to ./packages/relay/dist)
bun run build:relay

# Build the web dashboard (outputs packages/relay-web/dist)
bun run build:relay-web
```

::: tip 看板的构建是独立的
`build:relay-web` **不**属于 `build:packages` 的一部分。如果你跳过它，启动的将是一个没有界面的 API。请务必构建它，并将 `--web-root` 指向 `packages/relay-web/dist`（步骤 3）。
:::

服务端的入口是 `packages/relay/dist/cli.js`。发布之后，同样的命令面会以 `xacpx-relay` 二进制文件的形式暴露；下文中所有 `node packages/relay/dist/cli.js <command>` 都可替换为 `xacpx-relay <command>`。

## 2. 创建第一个管理员账户

Hub 将所有数据存放在单个 SQLite 文件中。请为它选择一个**稳定的绝对路径**——默认的 `./relay.db` 是相对于当前工作目录解析的，很容易在不知不觉中得到两个不同的数据库。

```bash
node packages/relay/dist/cli.js init-admin \
  --username admin \
  --db /var/lib/xacpx-relay/relay.db
```

如果你省略 `--password`，Hub 会自动生成一个并**只打印一次**：

```
admin account created: admin
password: 3f9c1ab27de40c85
(store it now — it is not shown again)
```

请立即将它保存到你的密码管理器中。

## 3. 启动服务端

```bash
node packages/relay/dist/cli.js start \
  --db /var/lib/xacpx-relay/relay.db \
  --web-root /opt/xacpx/packages/relay-web/dist \
  --host 0.0.0.0 \
  --http-port 8787 \
  --ws-port 8788 \
  --history-retention-days 30
```

成功后会打印：

```
xacpx-relay listening: http :8787, instance ws :8788, db /var/lib/xacpx-relay/relay.db
```

打开 `http://<host>:8787/`，使用步骤 2 中的管理员凭据登录。

### `start` 标志

| 标志 | 默认值 | 用途 |
|---|---|---|
| `--db <path>` | `./relay.db` | SQLite 数据库文件。请使用绝对路径。 |
| `--http-port <n>` | `8787` | HTTP API **以及**看板的 `/ws` 广播。 |
| `--ws-port <n>` | `8788` | 实例网关——xacpx 实例在此注册。 |
| `--host <addr>` | `0.0.0.0` | 绑定地址。 |
| `--web-root <dir>` | _（无）_ | 已构建的看板资源所在目录。**省略则不提供任何界面。** |
| `--history-retention-days <n>` | `30` | 超过此天数的缓存消息会被每小时清理一次（同时硬性上限为每会话 2000 条消息）。 |

没有 `stop`/`status` 子命令——请用 `Ctrl-C` / `SIGTERM` 停止 Hub（生产环境请在 systemd、pm2 或 Docker 下运行以管理生命周期）。

## 4. 配对一个 xacpx 实例

### 签发配对令牌（在 Hub 上）

```bash
node packages/relay/dist/cli.js token new \
  --account admin \
  --name home-pc \
  --ttl-minutes 10 \
  --db /var/lib/xacpx-relay/relay.db
```

输出：

```
pairing token: 8e1d…(single-use, expires soon)
expires at: 2026-06-13T12:00:00.000Z
pair with: xacpx channel add relay --url ws://<relay-host>:<ws-port> --token <the-token>
```

该令牌为**一次性使用**且短期有效（`--ttl-minutes`，默认 10 分钟）。

### 挂载实例

在运行 xacpx 实例的机器上，添加 relay 连接器频道，将 `--url` 指向**实例网关**端口（8788，或你的 `wss://` 代理）：

```bash
# After publish:
xacpx plugin add @ganglion/xacpx-channel-relay
xacpx channel add relay --url wss://relay.example.com --token <the-token> --name home-pc
xacpx restart
```

`--url` 必须以 `ws://` 或 `wss://` 开头；`--token` 是配对令牌；`--name` 可选。

首次连接时，实例会用这枚一次性配对令牌换取一个长期有效的凭据，并以 `0600` 权限写入 `<xacpx-home>/relay/credential.json`——**绝不会**写入 `config.json`（后者只保存 url/name）。请妥善保管该文件，它是实例的身份标识。

::: details 在连接器发布到 npm 之前进行配对
`xacpx plugin add` 会把它的参数直接传给 `npm install` / `bun add`，因此本地路径也可以使用——但 `@ganglion/xacpx-channel-relay` 依赖（同样未发布的）`@ganglion/xacpx-relay-protocol`，所以单纯的本地安装无法从 npm 解析出该依赖。在这些包正式发布之前，可靠的做法是：从一个 workspace 已经链接好两个包的仓库检出目录中运行实例，或者将两个包（先 `relay-protocol`，再 `channel-relay`）打包/链接到实例的插件目录中。发布之后，上面那两条命令就够了。
:::

回到看板，实例上线后会出现在左栏，并带有一个绿色圆点。选中某个会话即可聊天；打开任务面板（右栏，或移动端的 **Tasks** 按钮）可查看定时任务与编排任务。

## TLS 与反向代理 {#tls-reverse-proxy}

Hub 只说**明文** HTTP 和 WS。对于任何非 localhost 的部署，请在反向代理处终止 TLS，并同时转发 HTTP/web 端口和实例网关端口。实例随后应使用 `wss://` 连接。

看板的实时更新会在 **HTTP 端口**上发起 WebSocket 升级，因此代理也必须在该路由上允许升级。

### Caddy

```text
relay.example.com {
    reverse_proxy 127.0.0.1:8787   # HTTP API + dashboard + dashboard /ws (Caddy proxies upgrades automatically)
}

gateway.example.com {
    reverse_proxy 127.0.0.1:8788   # instance gateway; instances use wss://gateway.example.com
}
```

### nginx

```nginx
# Dashboard + HTTP API (port 8787, includes the dashboard /ws upgrade)
server {
    listen 443 ssl;
    server_name relay.example.com;
    # ssl_certificate ...; ssl_certificate_key ...;
    location / {
        proxy_pass http://127.0.0.1:8787;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host $host;
    }
}

# Instance gateway (port 8788) — instances connect with wss://gateway.example.com
server {
    listen 443 ssl;
    server_name gateway.example.com;
    # ssl_certificate ...; ssl_certificate_key ...;
    location / {
        proxy_pass http://127.0.0.1:8788;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host $host;
    }
}
```

### 应该暴露哪些端口

| 端口 | 面向对象 | 是否公开暴露？ |
|---|---|---|
| 8787 | 浏览器（看板 + API + 看板 `/ws`） | 是，需置于 TLS 之后 |
| 8788 | xacpx 实例（网关） | 是，需置于 TLS 之后 |
| — | `relay.db` | 绝不——它是一个本地文件 |

## 账户、邀请与维护

- **添加更多账户。** 管理员可以在看板的 **Settings** 页面生成一个**邀请令牌**；新的运维人员凭它创建自己的账户。邀请为一次性使用。
- **添加更多实例。** 为每个实例签发一个新的配对令牌（步骤 4）。
- **自动 GC。** 一个每小时运行的维护循环会清理超过 `--history-retention-days`（以及每会话 2000 条上限）的缓存消息，并删除过期的 Web 会话、邀请和配对令牌。无需配置 cron。

## 持久化与备份

所有数据都存放在 `--db` 指定的那个 SQLite 文件中。备份时，停止 Hub（或在空闲时刻做快照）并复制该文件：

```bash
cp /var/lib/xacpx-relay/relay.db /backups/relay-$(date +%F).db
```

丢失它就意味着丢失所有账户、实例注册信息和缓存历史——届时实例需要重新配对。

## 在 systemd 下运行（示例）

```ini
# /etc/systemd/system/xacpx-relay.service
[Unit]
Description=xacpx relay hub
After=network.target

[Service]
WorkingDirectory=/opt/xacpx
ExecStart=/usr/bin/node packages/relay/dist/cli.js start --db /var/lib/xacpx-relay/relay.db --web-root /opt/xacpx/packages/relay-web/dist --host 127.0.0.1
Restart=on-failure
User=xacpx

[Install]
WantedBy=multi-user.target
```

绑定到 `127.0.0.1`，让你的反向代理面向公网。

## 常见问题排查

| 现象 | 原因 | 解决办法 |
|---|---|---|
| 看板 404 / 空白页 | `--web-root` 被省略或填错 | 用 `bun run build:relay-web` 构建，并将 `--web-root` 指向 `packages/relay-web/dist`。 |
| 实例始终不变绿 | 网关 URL/端口错误，或令牌已过期 | 将 `--url` 指向 **8788** 网关（或其 `wss://` 代理）；配对令牌会过期（`--ttl-minutes`）且一次性使用——重新签发一个。 |
| “两个数据库” / 重启后为空 | 默认的 `./relay.db` 是相对于 cwd 的 | 始终传入绝对路径的 `--db`。 |
| 经过代理后实时更新卡住 | 代理未在 8787 上转发 WebSocket 升级 | 在看板路由上允许 `Upgrade`/`Connection` 请求头。 |

## 另请参阅

- [`docs/relay-module.md`](https://github.com/gadzan/xacpx/blob/main/docs/relay-module.md) —— 服务端 + 连接器内部实现。
- [`docs/relay-web-module.md`](https://github.com/gadzan/xacpx/blob/main/docs/relay-web-module.md) —— 看板架构。
- 设计规范：`docs/superpowers/specs/2026-06-13-relay-hub-design.md`。
