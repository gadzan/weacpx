import { expect, test } from "bun:test";

import {
  normalizeBridgeNonInteractivePermissions,
  normalizeBridgePermissionMode,
  normalizeBridgeQueueOwnerTtlSeconds,
} from "../../../src/bridge/bridge-env";

test("accepts deny for bridge non-interactive permissions", () => {
  expect(normalizeBridgeNonInteractivePermissions("deny")).toBe("deny");
});

test("defaults bridge non-interactive permissions to deny for invalid input", () => {
  expect(normalizeBridgeNonInteractivePermissions("bogus")).toBe("deny");
  expect(normalizeBridgeNonInteractivePermissions(undefined)).toBe("deny");
});

test("normalizes bridge permission mode with approve-all fallback", () => {
  expect(normalizeBridgePermissionMode("approve-reads")).toBe("approve-reads");
  expect(normalizeBridgePermissionMode("deny-all")).toBe("deny-all");
  expect(normalizeBridgePermissionMode("bogus")).toBe("approve-all");
});

test("normalizes bridge queue owner ttl seconds, preserving 0 and dropping invalid input", () => {
  expect(normalizeBridgeQueueOwnerTtlSeconds("1800")).toBe(1800);
  expect(normalizeBridgeQueueOwnerTtlSeconds("0")).toBe(0);
  expect(normalizeBridgeQueueOwnerTtlSeconds(undefined)).toBeUndefined();
  expect(normalizeBridgeQueueOwnerTtlSeconds("bogus")).toBeUndefined();
  expect(normalizeBridgeQueueOwnerTtlSeconds("-5")).toBeUndefined();
});
