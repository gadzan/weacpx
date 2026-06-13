# @ganglion/xacpx-relay

Self-hosted relay hub for xacpx. Multiple xacpx instances dial out to this
server over WebSocket; accounts log in over HTTP to manage and drive them.

Runtime: Node >= 22.13 (uses node:sqlite) or Bun >= 1.2 (uses bun:sqlite).
Two ports: HTTP API (default 8787) and instance WebSocket gateway (default 8788).

See `docs/relay-module.md` and the design spec
`docs/superpowers/specs/2026-06-13-relay-hub-design.md` in the repo root.
