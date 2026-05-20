import { describe, it, expect } from "bun:test";

import { interpretPollStatus } from "../../../../src/weixin/auth/login-qr.js";

describe("interpretPollStatus", () => {
  it("recognizes need_verifycode", () => {
    expect(interpretPollStatus("need_verifycode")).toBe("need_verifycode");
  });
  it("recognizes verify_code_blocked", () => {
    expect(interpretPollStatus("verify_code_blocked")).toBe("verify_code_blocked");
  });
  it("preserves wait/scaned/confirmed/expired/scaned_but_redirect", () => {
    expect(interpretPollStatus("wait")).toBe("wait");
    expect(interpretPollStatus("scaned")).toBe("scanned");
    expect(interpretPollStatus("confirmed")).toBe("confirmed");
    expect(interpretPollStatus("expired")).toBe("expired");
    expect(interpretPollStatus("scaned_but_redirect")).toBe("scaned_but_redirect");
  });
  it("falls back to wait for unknown status", () => {
    expect(interpretPollStatus("totally_unknown")).toBe("wait");
    expect(interpretPollStatus(undefined)).toBe("wait");
  });
});
