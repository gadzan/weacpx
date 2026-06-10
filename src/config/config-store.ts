import { readFile } from "node:fs/promises";

import { writePrivateFileAtomic } from "../util/private-file.js";

import { loadConfig, parseConfig } from "./load-config";
import type { AgentConfig, AppConfig, ChannelRuntimeConfig, PluginConfig } from "./types";

/**
 * Raw-patch config persistence.
 *
 * The parsed `AppConfig` is a READ model only: parsing drops unknown keys
 * (e.g. `workspaces.*.allowed_agents`), expands `~` in workspace cwds, and
 * materializes every default. Serializing it back would destroy a hand-edited
 * config.json. Every mutation therefore patches the raw JSON document read
 * straight from disk, touching only the targeted subtree, and never writes a
 * parsed config object.
 */

export type RawConfigPathSegment =
  | string
  | {
      /** Addresses the entry of a JSON array whose `id` property equals this value. */
      id: string;
      /** When set, a missing entry is materialized from this template on writes. */
      createWith?: Record<string, unknown>;
    };

export type RawConfigPath = readonly RawConfigPathSegment[];

export type RawConfigLookup = { present: true; value: unknown } | { present: false };

type RawConfig = Record<string, unknown>;

export class ConfigStore {
  constructor(private readonly path: string) {}

  async load(): Promise<AppConfig> {
    return await loadConfig(this.path);
  }

  /** Reads the raw (unparsed) value at `path`, e.g. to capture it for a rollback. */
  async getRawValue(path: RawConfigPath): Promise<RawConfigLookup> {
    return readRawConfigValue(await this.readRaw(), path);
  }

  async setRawValue(path: RawConfigPath, value: unknown): Promise<AppConfig> {
    return await this.patchRaw((raw) => {
      setRawConfigValue(raw, path, value);
    });
  }

  async unsetRawValue(path: RawConfigPath): Promise<AppConfig> {
    return await this.patchRaw((raw) => {
      unsetRawConfigValue(raw, path);
    });
  }

  async upsertWorkspace(name: string, cwd: string, description?: string): Promise<AppConfig> {
    return await this.patchRaw((raw) => {
      const workspaces = ensureRecordAt(raw, "workspaces");
      workspaces[name] = {
        cwd,
        ...(description ? { description } : {}),
      };
    });
  }

  async removeWorkspace(name: string): Promise<AppConfig> {
    return await this.patchRaw((raw) => {
      deleteRecordEntry(raw, "workspaces", name);
    });
  }

  async upsertAgent(name: string, agent: AgentConfig): Promise<AppConfig> {
    return await this.patchRaw((raw) => {
      const agents = ensureRecordAt(raw, "agents");
      agents[name] = {
        driver: agent.driver,
        ...(agent.command ? { command: agent.command } : {}),
      };
    });
  }

  async removeAgent(name: string): Promise<AppConfig> {
    return await this.patchRaw((raw) => {
      deleteRecordEntry(raw, "agents", name);
    });
  }

  /** Sets only the given transport keys; a key explicitly set to `undefined` is removed. */
  async updateTransport(patch: Partial<AppConfig["transport"]>): Promise<AppConfig> {
    return await this.patchRaw((raw) => {
      applyRecordPatch(ensureRecordAt(raw, "transport"), patch);
    });
  }

  /** Sets only the given channel keys; a key explicitly set to `undefined` is removed. */
  async updateChannel(patch: Partial<AppConfig["channel"]>): Promise<AppConfig> {
    return await this.patchRaw((raw) => {
      applyRecordPatch(ensureRecordAt(raw, "channel"), patch);
    });
  }

  /** Replaces the tool-managed `plugins` array; everything else stays untouched. */
  async replacePlugins(plugins: PluginConfig[]): Promise<AppConfig> {
    return await this.patchRaw((raw) => {
      raw.plugins = clonePlain(plugins);
    });
  }

  /** Replaces the tool-managed `channels` array; everything else stays untouched. */
  async replaceChannels(channels: ChannelRuntimeConfig[]): Promise<AppConfig> {
    return await this.patchRaw((raw) => {
      raw.channels = clonePlain(channels);
    });
  }

  private async patchRaw(mutate: (raw: RawConfig) => void): Promise<AppConfig> {
    const raw = await this.readRaw();
    mutate(raw);
    // Validate the patched document before it lands on disk. The read view
    // backfills the required sections so a sparse file (or a brand-new one)
    // still parses with defaults, without pinning those defaults into the file.
    const parsed = parseConfig({ transport: {}, agents: {}, workspaces: {}, ...raw });
    await writePrivateFileAtomic(this.path, serializeRawConfig(raw));
    return parsed;
  }

  private async readRaw(): Promise<RawConfig> {
    let text: string;
    try {
      text = await readFile(this.path, "utf8");
    } catch (error) {
      if (isMissingFileError(error)) {
        return {};
      }
      throw error;
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(text) as unknown;
    } catch (error) {
      throw new Error(
        `refusing to modify ${this.path}: it is not valid JSON (${
          error instanceof Error ? error.message : String(error)
        }); fix the file and retry`,
      );
    }
    if (!isPlainRecord(parsed)) {
      throw new Error(`refusing to modify ${this.path}: the top level must be a JSON object`);
    }
    return parsed;
  }
}

export function serializeRawConfig(raw: Record<string, unknown>): string {
  return `${JSON.stringify(raw, null, 2)}\n`;
}

export function readRawConfigValue(root: Record<string, unknown>, path: RawConfigPath): RawConfigLookup {
  const lastKey = requireObjectKeyTail(path);
  let container: unknown = root;
  for (const segment of path.slice(0, -1)) {
    const next = descendForRead(container, segment);
    if (!next.ok) {
      return { present: false };
    }
    container = next.value;
  }
  if (!isPlainRecord(container) || !(lastKey in container)) {
    return { present: false };
  }
  return { present: true, value: container[lastKey] };
}

export function setRawConfigValue(root: Record<string, unknown>, path: RawConfigPath, value: unknown): void {
  const lastKey = requireObjectKeyTail(path);
  let container: unknown = root;
  for (let index = 0; index < path.length - 1; index += 1) {
    const segment = path[index]!;
    const nextSegment = path[index + 1]!;
    container = descendForWrite(container, segment, typeof nextSegment !== "string", path);
  }
  if (!isPlainRecord(container)) {
    throw new Error(`config path "${describeRawConfigPath(path)}" does not address an object`);
  }
  container[lastKey] = value;
}

export function unsetRawConfigValue(root: Record<string, unknown>, path: RawConfigPath): void {
  const lastKey = requireObjectKeyTail(path);
  let container: unknown = root;
  for (const segment of path.slice(0, -1)) {
    const next = descendForRead(container, segment);
    if (!next.ok) {
      return;
    }
    container = next.value;
  }
  if (isPlainRecord(container)) {
    delete container[lastKey];
  }
}

function descendForRead(
  container: unknown,
  segment: RawConfigPathSegment,
): { ok: true; value: unknown } | { ok: false } {
  if (typeof segment === "string") {
    if (!isPlainRecord(container) || !(segment in container)) {
      return { ok: false };
    }
    return { ok: true, value: container[segment] };
  }
  if (!Array.isArray(container)) {
    return { ok: false };
  }
  const entry = container.find((item) => isPlainRecord(item) && item.id === segment.id);
  return entry === undefined ? { ok: false } : { ok: true, value: entry };
}

function descendForWrite(
  container: unknown,
  segment: RawConfigPathSegment,
  nextIsArrayEntry: boolean,
  path: RawConfigPath,
): unknown {
  if (typeof segment === "string") {
    if (!isPlainRecord(container)) {
      throw new Error(`config path "${describeRawConfigPath(path)}" does not address an object at "${segment}"`);
    }
    let existing = container[segment];
    if (existing === undefined) {
      existing = nextIsArrayEntry ? [] : {};
      container[segment] = existing;
    }
    if (!isPlainRecord(existing) && !Array.isArray(existing)) {
      throw new Error(
        `refusing to overwrite config key "${segment}" (path "${describeRawConfigPath(path)}"): it is not an object`,
      );
    }
    return existing;
  }

  if (!Array.isArray(container)) {
    throw new Error(`config path "${describeRawConfigPath(path)}" expects an array before [id=${segment.id}]`);
  }
  const entry = container.find((item) => isPlainRecord(item) && item.id === segment.id);
  if (entry !== undefined) {
    return entry;
  }
  if (!segment.createWith) {
    throw new Error(`config path "${describeRawConfigPath(path)}" has no entry with id "${segment.id}"`);
  }
  const created = clonePlain(segment.createWith);
  container.push(created);
  return created;
}

function requireObjectKeyTail(path: RawConfigPath): string {
  const last = path[path.length - 1];
  if (typeof last !== "string") {
    throw new Error("raw config path must end with an object key");
  }
  return last;
}

function describeRawConfigPath(path: RawConfigPath): string {
  return path.map((segment) => (typeof segment === "string" ? segment : `[id=${segment.id}]`)).join(".");
}

function ensureRecordAt(raw: RawConfig, key: string): RawConfig {
  const existing = raw[key];
  if (existing === undefined) {
    const created: RawConfig = {};
    raw[key] = created;
    return created;
  }
  if (!isPlainRecord(existing)) {
    throw new Error(`refusing to overwrite config key "${key}": it is not a JSON object`);
  }
  return existing;
}

function deleteRecordEntry(raw: RawConfig, section: string, name: string): void {
  const record = raw[section];
  if (isPlainRecord(record)) {
    delete record[name];
  }
}

function applyRecordPatch(target: RawConfig, patch: Record<string, unknown>): void {
  for (const [key, value] of Object.entries(patch)) {
    if (value === undefined) {
      delete target[key];
    } else {
      target[key] = value;
    }
  }
}

function clonePlain<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isMissingFileError(error: unknown): error is NodeJS.ErrnoException {
  return typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT";
}
