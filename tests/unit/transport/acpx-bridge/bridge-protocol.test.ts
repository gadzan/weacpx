import { describe, expect, test } from "bun:test";
import {
  encodeBridgeSessionProgressEvent,
  type BridgeErrorResponse,
  type BridgeSessionProgressEvent,
  type EnsureSessionErrorKind,
} from "../../../../src/transport/acpx-bridge/acpx-bridge-protocol";

describe("bridge protocol progress + structured error", () => {
  test("encodes session.progress event as NDJSON", () => {
    const event: BridgeSessionProgressEvent = {
      id: "42",
      event: "session.progress",
      stage: "initializing",
    };
    expect(encodeBridgeSessionProgressEvent(event)).toBe(
      `${JSON.stringify(event)}\n`,
    );
  });

  test("error response accepts kind and data", () => {
    const response: BridgeErrorResponse = {
      id: "1",
      ok: false,
      error: {
        code: "BRIDGE_ENSURE_SESSION_FAILED",
        message: "...",
        kind: "missing_optional_dep" satisfies EnsureSessionErrorKind,
        data: { package: "opencode-windows-x64", parentPackagePath: "/path" },
      },
    };
    expect(response.error.kind).toBe("missing_optional_dep");
  });
});
