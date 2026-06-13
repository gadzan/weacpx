# Self-Hosting the Relay Hub

The **relay hub** is an optional, self-hosted server that turns xacpx into a multi-tenant remote-control dashboard. Your xacpx instances dial **out** to the hub over WebSocket and register; you then log in to a web dashboard from any browser and drive every instance's sessions — chat, scheduled tasks, and orchestration — from one place.

This guide walks an operator from nothing to a running hub with a paired instance.

::: warning Pre-release: build from source
The relay packages (`@ganglion/xacpx-relay`, `@ganglion/xacpx-channel-relay`, `@ganglion/xacpx-relay-protocol`, `@ganglion/xacpx-relay-web`) are built and audited but **not yet published to npm**. Until they are, you deploy the hub from a checkout of the repository, as shown below. Once published, the `xacpx-relay` binary and `xacpx plugin add @ganglion/xacpx-channel-relay` become one-line installs — both paths are noted.
:::

## Architecture at a glance

```
   xacpx instance A ─┐                         ┌─ browser (account: alice)
   xacpx instance B ─┤  WSS (dial-out)         │  HTTPS + WSS
   xacpx instance C ─┴──────────────►  RELAY HUB  ◄───────────┘
                       :8788 instance gateway   :8787 HTTP API + web /ws
                                  │
                              relay.db (SQLite)
```

- **Two ports.** The HTTP API and the dashboard's `/ws` fan-out share **8787**; the **instance** WebSocket gateway (where xacpx instances register) is **8788**. They are separate so you can firewall them independently.
- **Multi-tenant.** Every account only ever sees its own instances and sessions; the server stamps identity on each proxied call. Secrets (passwords, pairing tokens, instance credentials, web-session cookies) are stored hashed.
- **Source of truth stays on the instances.** The hub caches recent messages for the dashboard but does not own your sessions — the instances do.

## Requirements

- **Node.js ≥ 22.13** (uses the built-in `node:sqlite`) **or Bun ≥ 1.2** (uses `bun:sqlite`). No native database addon to compile.
- A host reachable by your instances and your browser. For anything beyond localhost you want a TLS-terminating reverse proxy (see [TLS & reverse proxy](#tls-reverse-proxy)).
- To pair instances, each instance needs the `xacpx` CLI (the normal install from [Getting Started](/guide/getting-started)).

## 1. Get the server

Clone the repository and build the relay server and the dashboard:

```bash
git clone https://github.com/gadzan/xacpx
cd xacpx
bun install

# Build the hub server (compiles relay-protocol + relay to ./packages/relay/dist)
bun run build:relay

# Build the web dashboard (outputs packages/relay-web/dist)
bun run build:relay-web
```

::: tip The dashboard build is separate
`build:relay-web` is **not** part of `build:packages`. If you skip it you will start an API with no UI. Always build it and point `--web-root` at `packages/relay-web/dist` (step 3).
:::

The server entry point is `packages/relay/dist/cli.js`. After publish this same surface is exposed as the `xacpx-relay` binary; substitute `xacpx-relay <command>` for `node packages/relay/dist/cli.js <command>` everywhere below.

## 2. Create the first admin account

The hub stores everything in a single SQLite file. Pick a **stable, absolute** path for it — the default `./relay.db` is resolved relative to the current working directory, which is an easy way to end up with two different databases.

```bash
node packages/relay/dist/cli.js init-admin \
  --username admin \
  --db /var/lib/xacpx-relay/relay.db
```

If you omit `--password`, the hub generates one and prints it **once**:

```
admin account created: admin
password: 3f9c1ab27de40c85
(store it now — it is not shown again)
```

Save it in your password manager immediately.

## 3. Start the server

```bash
node packages/relay/dist/cli.js start \
  --db /var/lib/xacpx-relay/relay.db \
  --web-root /opt/xacpx/packages/relay-web/dist \
  --host 0.0.0.0 \
  --http-port 8787 \
  --ws-port 8788 \
  --history-retention-days 30
```

On success it prints:

```
xacpx-relay listening: http :8787, instance ws :8788, db /var/lib/xacpx-relay/relay.db
```

Open `http://<host>:8787/` and log in with the admin credentials from step 2.

### `start` flags

| Flag | Default | Purpose |
|---|---|---|
| `--db <path>` | `./relay.db` | SQLite database file. Use an absolute path. |
| `--http-port <n>` | `8787` | HTTP API **and** the dashboard's `/ws` fan-out. |
| `--ws-port <n>` | `8788` | Instance gateway — where xacpx instances register. |
| `--host <addr>` | `0.0.0.0` | Bind address. |
| `--web-root <dir>` | _(none)_ | Directory of built dashboard assets. **Omit and no UI is served.** |
| `--history-retention-days <n>` | `30` | Cached messages older than this are pruned hourly (also hard-capped at 2000 messages per session). |

There is no `stop`/`status` subcommand — stop the hub with `Ctrl-C` / `SIGTERM` (run it under systemd, pm2, or Docker for lifecycle management).

## 4. Pair an xacpx instance

### Mint a pairing token (on the hub)

```bash
node packages/relay/dist/cli.js token new \
  --account admin \
  --name home-pc \
  --ttl-minutes 10 \
  --db /var/lib/xacpx-relay/relay.db
```

Output:

```
pairing token: 8e1d…(single-use, expires soon)
expires at: 2026-06-13T12:00:00.000Z
pair with: xacpx channel add relay --url ws://<relay-host>:<ws-port> --token <the-token>
```

The token is **single-use** and short-lived (`--ttl-minutes`, default 10).

### Attach the instance

On the machine running the xacpx instance, add the relay connector channel, pointing `--url` at the **instance gateway** port (8788, or your `wss://` proxy):

```bash
# After publish:
xacpx plugin add @ganglion/xacpx-channel-relay
xacpx channel add relay --url wss://relay.example.com --token <the-token> --name home-pc
xacpx restart
```

`--url` must start with `ws://` or `wss://`; `--token` is the pairing token; `--name` is optional.

On first connect the instance exchanges the one-shot pairing token for a long-lived credential, written (mode `0600`) to `<xacpx-home>/relay/credential.json` — **never** to `config.json` (which only keeps the url/name). Keep that file safe; it is the instance's identity.

::: details Pairing the connector before it is published to npm
`xacpx plugin add` passes its argument straight to `npm install` / `bun add`, so a local path works — but `@ganglion/xacpx-channel-relay` depends on the (also unpublished) `@ganglion/xacpx-relay-protocol`, so a bare local install will not resolve that dependency from npm. Until the packages are released, the reliable path is to run the instance from a repo checkout where the workspace already links both packages, or to pack/link both (`relay-protocol` then `channel-relay`) into the instance's plugin home. After release, the two commands above are all you need.
:::

Back in the dashboard, the instance appears in the left column with a green dot once it is online. Select a session to chat; open the task panel (right column, or the **Tasks** button on mobile) for scheduled and orchestration tasks.

## TLS & reverse proxy {#tls-reverse-proxy}

The hub speaks **plain** HTTP and WS. For any non-localhost deployment, terminate TLS at a reverse proxy and forward both the HTTP/web port and the instance-gateway port. Instances should then connect with `wss://`.

The dashboard's live updates use a WebSocket upgrade on the **HTTP port**, so the proxy must allow upgrades on that route as well.

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

### Which ports to expose

| Port | Audience | Expose publicly? |
|---|---|---|
| 8787 | Browsers (dashboard + API + dashboard `/ws`) | Yes, behind TLS |
| 8788 | xacpx instances (gateway) | Yes, behind TLS |
| — | `relay.db` | Never — it is a local file |

## Accounts, invites & maintenance

- **More accounts.** An admin can generate an **invite token** from the dashboard's **Settings** page; a new operator redeems it to create their own account. Invites are single-use.
- **More instances.** Mint another pairing token (step 4) per instance.
- **Automatic GC.** An hourly maintenance loop prunes cached messages past `--history-retention-days` (and the 2000-per-session cap) and deletes expired web sessions, invites, and pairing tokens. No cron needed.

## Persistence & backup

Everything lives in the one SQLite file at `--db`. To back up, stop the hub (or snapshot during a quiet moment) and copy the file:

```bash
cp /var/lib/xacpx-relay/relay.db /backups/relay-$(date +%F).db
```

Losing it means losing accounts, instance registrations, and cached history — instances would need to be re-paired.

## Running under systemd (example)

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

Bind to `127.0.0.1` and let your reverse proxy face the internet.

## Troubleshooting

| Symptom | Cause | Fix |
|---|---|---|
| Dashboard 404 / blank page | `--web-root` omitted or wrong | Build with `bun run build:relay-web`, point `--web-root` at `packages/relay-web/dist`. |
| Instance never turns green | Wrong gateway URL/port, or expired token | Point `--url` at the **8788** gateway (or its `wss://` proxy); pairing tokens expire (`--ttl-minutes`) and are single-use — mint a fresh one. |
| "two databases" / empty after restart | Default `./relay.db` is cwd-relative | Always pass an absolute `--db`. |
| Live updates stall behind a proxy | Proxy not forwarding WebSocket upgrades on 8787 | Allow `Upgrade`/`Connection` headers on the dashboard route. |

## See also

- [`docs/relay-module.md`](https://github.com/gadzan/xacpx/blob/main/docs/relay-module.md) — server + connector internals.
- [`docs/relay-web-module.md`](https://github.com/gadzan/xacpx/blob/main/docs/relay-web-module.md) — dashboard architecture.
- Design spec: `docs/superpowers/specs/2026-06-13-relay-hub-design.md`.
