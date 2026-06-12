# @ganglion/xacpx-relay-protocol

Shared wire protocol for the xacpx relay hub: the JSON envelope exchanged over
WebSocket between xacpx instances, the relay server, and the web frontend, plus
the wire DTOs that mirror the core Control API surface.

Pure types + codecs. No runtime dependencies; does not depend on xacpx.

See `docs/superpowers/specs/2026-06-13-relay-hub-design.md` in the repo root for
the overall design.
