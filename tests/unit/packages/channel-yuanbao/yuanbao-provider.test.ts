import { expect, test } from "bun:test";

import { yuanbaoCliProvider as provider } from "../../../../packages/channel-yuanbao/src/yuanbao-provider";

test("yuanbao provider parses flags and redacts secrets", async () => {
  const parsed = provider.parseAddArgs([
    "--app-key",
    "yb_key",
    "--app-secret",
    "yb_secret",
    "--require-mention",
    "false",
    "--max-chars",
    "2800",
  ]);

  expect(parsed).toEqual({
    ok: true,
    input: {
      appKey: "yb_key",
      appSecret: "yb_secret",
      requireMention: false,
      maxChars: "2800",
    },
  });

  const config = provider.buildDefaultConfig(parsed.ok ? parsed.input : {});
  expect(config).toMatchObject({
    id: "yuanbao",
    type: "yuanbao",
    enabled: true,
    options: {
      appKey: "yb_key",
      appSecret: "yb_secret",
      requireMention: false,
      maxChars: 2800,
    },
  });
  expect(provider.renderSummary(config)).toContain("appSecret: ***");
  expect(provider.renderSummary(config)).toContain("gateway: builtin");
  expect(provider.renderSummary(config).join("\n")).not.toContain("yb_secret");
});

test("yuanbao provider does not require a user-supplied gateway module", () => {
  const config = provider.buildDefaultConfig({});
  const missingIssues = provider.validateConfig(config).filter((issue) => issue.kind === "missing-required-field");

  expect(missingIssues.map((issue) => issue.flag)).toEqual(["--app-key", "--app-secret"]);
});

test("yuanbao provider requires botId for static token but not appKey:appSecret token", () => {
  const staticTokenConfig = provider.buildDefaultConfig({ token: "static-token" });
  expect(provider.validateConfig(staticTokenConfig).map((issue) => issue.kind === "missing-required-field" ? issue.flag : "")).toContain("--bot-id");

  const pairTokenConfig = provider.buildDefaultConfig({ token: "key:secret" });
  expect(provider.validateConfig(pairTokenConfig)).toEqual([]);
});

test("yuanbao provider exposes multi-account CLI metadata", () => {
  expect(provider.supportsMultipleAccounts).toBe(true);
  expect(provider.channelLevelOptionKeys).toEqual(["defaultAccount", "accounts", "gatewayModule"]);
  expect(typeof provider.buildAccountOverride).toBe("function");
  expect(typeof provider.renderAccountSummary).toBe("function");
});

test("yuanbao buildAccountOverride excludes channel-level keys and undefined fields", () => {
  const override = provider.buildAccountOverride!({
    appKey: "yb_main",
    appSecret: "secret_main",
    botId: "bot_main",
    requireMention: false,
    maxChars: "2800",
  });
  expect(override).toEqual({
    appKey: "yb_main",
    appSecret: "secret_main",
    botId: "bot_main",
    requireMention: false,
    maxChars: 2800,
  });
  expect(override).not.toHaveProperty("defaultAccount");
  expect(override).not.toHaveProperty("accounts");
  expect(override).not.toHaveProperty("gatewayModule");
});

test("yuanbao renderAccountSummary shows account fields with secret redaction", () => {
  const config = {
    id: "yuanbao",
    type: "yuanbao",
    enabled: true,
    options: {
      defaultAccount: "main",
      accounts: {
        main: { appKey: "yb_main", appSecret: "secret_main", botId: "bot_main", name: "Main Bot" },
        review: { appKey: "yb_review", appSecret: "secret_review", enabled: false },
      },
    },
  };
  const main = provider.renderAccountSummary!(config, "main");
  expect(main).not.toBeNull();
  expect(main!.join("\n")).toContain("account: main (Main Bot)");
  expect(main!).toContain("appKey: yb_main");
  expect(main!).toContain("appSecret: ***");
  expect(main!).toContain("botId: bot_main");

  const review = provider.renderAccountSummary!(config, "review");
  expect(review!.join("\n")).toContain("account: review");
  expect(review!.join("\n")).toContain("[disabled]");

  expect(provider.renderAccountSummary!(config, "missing")).toBeNull();
});

test("yuanbao validateConfig accepts a multi-account config with one usable account", () => {
  const config = {
    id: "yuanbao", type: "yuanbao", enabled: true,
    options: {
      defaultAccount: "main",
      accounts: {
        main: { appKey: "yb_main", appSecret: "secret_main" },
        ops: { appKey: "yb_ops", appSecret: "secret_ops", enabled: false },
      },
    },
  };
  expect(provider.validateConfig(config)).toEqual([]);
});

test("yuanbao validateConfig rejects accounts: {}", () => {
  const config = {
    id: "yuanbao", type: "yuanbao", enabled: true,
    options: { defaultAccount: "main", accounts: {} },
  };
  const issues = provider.validateConfig(config);
  expect(issues.length).toBeGreaterThan(0);
  expect(issues.every((issue) => issue.kind === "invalid-config")).toBe(true);
});

test("yuanbao validateConfig accepts static token + botId under accounts", () => {
  const config = {
    id: "yuanbao", type: "yuanbao", enabled: true,
    options: {
      defaultAccount: "main",
      accounts: {
        main: { token: "static-token", botId: "bot_123" },
      },
    },
  };
  expect(provider.validateConfig(config)).toEqual([]);
});

test("yuanbao validateConfig rejects static token without botId under accounts", () => {
  const config = {
    id: "yuanbao", type: "yuanbao", enabled: true,
    options: {
      defaultAccount: "main",
      accounts: {
        main: { token: "static-token" },
      },
    },
  };
  const issues = provider.validateConfig(config);
  expect(issues.length).toBeGreaterThan(0);
});

test("yuanbao buildAccountOverride round-trips token and botId", () => {
  const parsed = provider.parseAddArgs([
    "--token", "static-token",
    "--bot-id", "bot_123",
    "--api-domain", "custom.bot.yuanbao.tencent.com",
    "--ws-url", "wss://custom/wss",
  ]);
  expect(parsed.ok).toBe(true);
  const override = provider.buildAccountOverride!(parsed.ok ? parsed.input : {});
  expect(override).toEqual({
    token: "static-token",
    botId: "bot_123",
    apiDomain: "custom.bot.yuanbao.tencent.com",
    wsUrl: "wss://custom/wss",
  });
});

test("yuanbao renderAccountSummary handles legacy flat config under defaultAccount", () => {
  const config = {
    id: "yuanbao",
    type: "yuanbao",
    enabled: true,
    options: {
      appKey: "yb_legacy",
      appSecret: "secret_legacy",
      botId: "bot_legacy",
    },
  };
  const summary = provider.renderAccountSummary!(config, "default");
  expect(summary).not.toBeNull();
  expect(summary!).toContain("appKey: yb_legacy");
  expect(summary!).toContain("appSecret: ***");
  expect(provider.renderAccountSummary!(config, "other")).toBeNull();
});
