import { describe, expect, it } from "bun:test";
import { stableCoordinatorSession } from "../../../src/orchestration/coordinator-identity";

describe("stableCoordinatorSession", () => {
  it("returns a normal transport session unchanged", () => {
    expect(stableCoordinatorSession("ws:alias")).toBe("ws:alias");
  });

  it("strips a trailing :reset-<timestamp> suffix", () => {
    expect(stableCoordinatorSession("ws:alias:reset-1700000000000")).toBe("ws:alias");
  });

  it("only strips a single trailing reset segment and keeps the stable base", () => {
    // /clear always rebuilds from workspace+alias, so there is never more than one reset segment
    expect(stableCoordinatorSession("teamA:weixin:bob:reset-42")).toBe("teamA:weixin:bob");
  });

  it("is a no-op on external coordinator identities", () => {
    expect(stableCoordinatorSession("external_claude-code:abcd1234")).toBe(
      "external_claude-code:abcd1234",
    );
  });

  it("does not strip a non-numeric reset-like segment", () => {
    expect(stableCoordinatorSession("ws:alias:reset-notanumber")).toBe("ws:alias:reset-notanumber");
  });

  it("does not strip when reset appears mid-string", () => {
    expect(stableCoordinatorSession("ws:reset-1:alias")).toBe("ws:reset-1:alias");
  });
});
