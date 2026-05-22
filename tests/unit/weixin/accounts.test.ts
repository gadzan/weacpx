import fs from "node:fs";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { expect, test } from "bun:test";

import { clearAllWeixinAccounts, listWeixinAccountIds, loadWeixinAccount, registerWeixinAccountId, saveWeixinAccount } from "../../../src/weixin/auth/accounts";

async function withTempStateDir<T>(fn: (stateDir: string) => Promise<T>): Promise<T> {
  const stateDir = await mkdtemp(path.join(tmpdir(), "weacpx-openclaw-"));
  const previousStateDir = process.env.OPENCLAW_STATE_DIR;
  process.env.OPENCLAW_STATE_DIR = stateDir;

  try {
    return await fn(stateDir);
  } finally {
    if (previousStateDir === undefined) {
      delete process.env.OPENCLAW_STATE_DIR;
    } else {
      process.env.OPENCLAW_STATE_DIR = previousStateDir;
    }
    await rm(stateDir, { recursive: true, force: true });
  }
}

test("registerWeixinAccountId tolerates EPERM when the state directory already exists", async () => {
  await withTempStateDir(async (stateDir) => {
    const weixinDir = path.join(stateDir, "openclaw-weixin");
    await mkdir(weixinDir, { recursive: true });

    const originalMkdirSync = fs.mkdirSync;
    fs.mkdirSync = ((target: fs.PathLike, options?: fs.MakeDirectoryOptions) => {
      if (path.resolve(String(target)) === path.resolve(weixinDir)) {
        const error = new Error(`EPERM: operation not permitted, mkdir '${target}'`) as NodeJS.ErrnoException;
        error.code = "EPERM";
        error.errno = -4048;
        error.syscall = "mkdir";
        error.path = String(target);
        throw error;
      }
      return originalMkdirSync.call(fs, target, options);
    }) as typeof fs.mkdirSync;

    try {
      registerWeixinAccountId("e33867cf4ec7-im-bot");
    } finally {
      fs.mkdirSync = originalMkdirSync;
    }

    const raw = await readFile(path.join(weixinDir, "accounts.json"), "utf-8");
    expect(JSON.parse(raw)).toEqual(["e33867cf4ec7-im-bot"]);
  });
});


test("saveWeixinAccount writes the credential file with owner-only permissions", async () => {
  if (process.platform === "win32") return;
  await withTempStateDir(async (stateDir) => {
    const accountId = "e33867cf4ec7-im-bot";
    saveWeixinAccount(accountId, { token: "secret-token", baseUrl: "https://example.com" });

    const accountFile = path.join(stateDir, "openclaw-weixin", "accounts", `${accountId}.json`);
    expect(fs.statSync(accountFile).mode & 0o777).toBe(0o600);
    expect(loadWeixinAccount(accountId)?.token).toBe("secret-token");
  });
});

test("clearAllWeixinAccounts clears credential files even when the account index is empty", async () => {
  await withTempStateDir(async (stateDir) => {
    const weixinDir = path.join(stateDir, "openclaw-weixin");
    const accountsDir = path.join(weixinDir, "accounts");
    const accountId = "e33867cf4ec7-im-bot";
    const accountFile = path.join(accountsDir, `${accountId}.json`);
    const syncFile = path.join(accountsDir, `${accountId}.sync.json`);

    await mkdir(accountsDir, { recursive: true });
    await writeFile(path.join(weixinDir, "accounts.json"), "[]", "utf-8");
    await writeFile(accountFile, JSON.stringify({ token: "token", baseUrl: "https://example.com" }), "utf-8");
    await writeFile(syncFile, JSON.stringify({ get_updates_buf: "buf" }), "utf-8");

    expect(listWeixinAccountIds()).toEqual([accountId]);

    clearAllWeixinAccounts();

    expect(fs.existsSync(accountFile)).toBe(false);
    expect(fs.existsSync(syncFile)).toBe(true);
    expect(JSON.parse(await readFile(path.join(weixinDir, "accounts.json"), "utf-8"))).toEqual([]);
    expect(listWeixinAccountIds()).toEqual([]);
  });
});
