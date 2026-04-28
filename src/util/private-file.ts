import { randomBytes } from "node:crypto";
import { chmod, mkdir, rename, unlink, writeFile } from "node:fs/promises";
import { basename, dirname, join } from "node:path";

const PRIVATE_FILE_MODE = 0o600;

export async function writePrivateFileAtomic(path: string, content: string): Promise<void> {
  const dir = dirname(path);
  await mkdir(dir, { recursive: true });
  const tmpPath = join(dir, `.${basename(path)}.${process.pid}.${randomBytes(6).toString("hex")}.tmp`);

  try {
    await writeFile(tmpPath, content, { encoding: "utf8", mode: PRIVATE_FILE_MODE });
    await chmodPrivate(tmpPath);
    await rename(tmpPath, path);
    await chmodPrivate(path);
  } catch (error) {
    await unlinkIfExists(tmpPath);
    throw error;
  }
}

async function chmodPrivate(path: string): Promise<void> {
  if (process.platform === "win32") return;
  await chmod(path, PRIVATE_FILE_MODE).catch(() => {});
}

async function unlinkIfExists(path: string): Promise<void> {
  await unlink(path).catch(() => {});
}
