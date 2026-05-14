import fs from "node:fs";
import { mkdir, mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { expect, test } from "bun:test";

import { registerWeixinAccountId } from "../../../src/weixin/auth/accounts";

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
