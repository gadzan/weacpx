import { expect, test } from "bun:test";

import { translateAcpxNote } from "../../../src/commands/translate-acpx-note";

test("translates built-in agent spawn line", () => {
  expect(
    translateAcpxNote("[acpx] spawning installed built-in agent opencode@0.1.2 via npx opencode"),
  ).toBe("🔩 正在启动内置 agent `opencode`");
});

test("translates generic agent spawn line", () => {
  expect(translateAcpxNote("[acpx] spawning agent: npx codex-acp")).toBe(
    "🔩 正在启动 agent 进程",
  );
});

test("translates npm download lines", () => {
  expect(translateAcpxNote("npm http fetch GET 200 https://registry.npmjs.org/opencode")).toBe(
    "📥 正在下载 agent 依赖…",
  );
});

test("translates extraction lines", () => {
  expect(translateAcpxNote("extracting opencode-0.1.2.tgz")).toBe("🧩 正在安装 agent 依赖…");
});

test("falls back to truncated raw line for unknown patterns", () => {
  const out = translateAcpxNote("something the user probably cares about");
  expect(out).toBe("ℹ️ something the user probably cares about");
});

test("truncates overly long fallback lines", () => {
  const long = "a".repeat(200);
  const out = translateAcpxNote(long);
  expect(out).toBeDefined();
  expect(out!.length).toBeLessThanOrEqual(84);
  expect(out!.endsWith("…")).toBe(true);
});

test("returns null for blank lines", () => {
  expect(translateAcpxNote("")).toBeNull();
  expect(translateAcpxNote("[acpx] ")).toBeNull();
});

test("drops low-value npm timing/notice/info lines", () => {
  expect(translateAcpxNote("npm timing npm:load:setTitle Completed in 0ms")).toBeNull();
  expect(translateAcpxNote("npm notice Beginning October 4, 2021, ...")).toBeNull();
  expect(translateAcpxNote("npm verb cli /usr/bin/node")).toBeNull();
});

test("translates pnpm/yarn/bun install as download", () => {
  expect(translateAcpxNote("pnpm add opencode")).toBe("📥 正在下载 agent 依赖…");
  expect(translateAcpxNote("yarn install")).toBe("📥 正在下载 agent 依赖…");
  expect(translateAcpxNote("bun install --production")).toBe("📥 正在下载 agent 依赖…");
});
