import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname } from "node:path";

import { createEmptyState, type AppState } from "./types";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function parseState(raw: unknown, path: string): AppState {
  if (!isRecord(raw)) {
    throw new Error(`state file "${path}" must contain a JSON object`);
  }

  const sessions = raw.sessions;
  if (!isRecord(sessions)) {
    throw new Error(`state file "${path}" must contain an object field "sessions"`);
  }

  const chatContexts = raw.chat_contexts;
  if (!isRecord(chatContexts)) {
    throw new Error(`state file "${path}" must contain an object field "chat_contexts"`);
  }

  return {
    sessions: sessions as AppState["sessions"],
    chat_contexts: chatContexts as AppState["chat_contexts"],
  };
}

export class StateStore {
  constructor(private readonly path: string) {}

  async load(): Promise<AppState> {
    try {
      const content = await readFile(this.path, "utf8");
      if (content.trim() === "") {
        return createEmptyState();
      }

      let parsed: unknown;
      try {
        parsed = JSON.parse(content) as unknown;
      } catch (error) {
        throw new Error(`failed to parse state file "${this.path}"`, {
          cause: error,
        });
      }

      return parseState(parsed, this.path);
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
