import { mkdir, readFile, rm } from "node:fs/promises";
import { dirname } from "node:path";

import writeFileAtomic from "write-file-atomic";

export interface DaemonStatus {
  pid: number;
  started_at: string;
  heartbeat_at: string;
  config_path: string;
  state_path: string;
  app_log: string;
  stdout_log: string;
  stderr_log: string;
}

export class DaemonStatusStore {
  constructor(private readonly path: string) {}

  async load(): Promise<DaemonStatus | null> {
    try {
      const content = await readFile(this.path, "utf8");
      if (content.trim() === "") {
        return null;
      }
      return JSON.parse(content) as DaemonStatus;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") {
        return null;
      }
      if (error instanceof SyntaxError) {
        return null;
      }
      throw error;
    }
  }

  async save(status: DaemonStatus): Promise<void> {
    await mkdir(dirname(this.path), { recursive: true });
    await writeFileAtomic(this.path, JSON.stringify(status, null, 2), { encoding: "utf8" });
  }

  async clear(): Promise<void> {
    await rm(this.path, { force: true });
  }
}
