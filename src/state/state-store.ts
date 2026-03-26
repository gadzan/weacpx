import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname } from "node:path";

import { createEmptyState, type AppState } from "./types";

export class StateStore {
  constructor(private readonly path: string) {}

  async load(): Promise<AppState> {
    try {
      const content = await readFile(this.path, "utf8");
      if (content.trim() === "") {
        return createEmptyState();
      }
      return JSON.parse(content) as AppState;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") {
        return createEmptyState();
      }
      throw error;
    }
  }

  async save(state: AppState): Promise<void> {
    await mkdir(dirname(this.path), { recursive: true });
    await writeFile(this.path, JSON.stringify(state, null, 2));
  }
}
