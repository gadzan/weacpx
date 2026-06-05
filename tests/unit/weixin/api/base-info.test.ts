import { describe, it, expect } from "bun:test";
import { buildBaseInfo, sanitizeBotAgent } from "../../../../src/weixin/api/api.js";

describe("sanitizeBotAgent", () => {
  it("returns DEFAULT when input is empty/whitespace/undefined", () => {
    expect(sanitizeBotAgent(undefined)).toBe("xacpx");
    expect(sanitizeBotAgent("")).toBe("xacpx");
    expect(sanitizeBotAgent("   ")).toBe("xacpx");
  });

  it("accepts a valid single product token", () => {
    expect(sanitizeBotAgent("MyApp/1.0.0")).toBe("MyApp/1.0.0");
  });

  it("accepts product with parenthesized comment", () => {
    expect(sanitizeBotAgent("MyApp/1.0.0 (foo bar)")).toBe("MyApp/1.0.0 (foo bar)");
  });

  it("drops malformed tokens silently", () => {
    expect(sanitizeBotAgent("Good/1.0 !!!bad!!! Also/2.0")).toBe("Good/1.0 Also/2.0");
  });

  it("falls back to DEFAULT when all tokens are dropped", () => {
    expect(sanitizeBotAgent("!!! @@@ ###")).toBe("xacpx");
  });

  it("truncates over the 256-byte cap", () => {
    const long = Array.from({ length: 50 }, (_, i) => `Tok${i}/1.0`).join(" ");
    const out = sanitizeBotAgent(long);
    expect(Buffer.byteLength(out, "utf-8")).toBeLessThanOrEqual(256);
  });
});

describe("buildBaseInfo", () => {
  it("includes channel_version and bot_agent", () => {
    const info = buildBaseInfo();
    expect(typeof info.channel_version).toBe("string");
    expect(typeof info.bot_agent).toBe("string");
    expect(info.bot_agent!.length).toBeGreaterThan(0);
  });
});
