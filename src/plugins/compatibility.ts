// Plugin compatibility primitives. Pure functions: no fs, no imports outside
// of types. The plugin loader, validator, and doctor reuse these to decide
// whether a plugin built for a given WeacpxPlugin API version and core
// version range is compatible with the running weacpx.

export const WEACPX_PLUGIN_API_VERSION = 1 as const;
export const WEACPX_PLUGIN_API_SUPPORTED_VERSIONS: readonly number[] = [1];

// Minimum core version that the current plugin API version corresponds to.
// First-party plugins should declare `minWeacpxVersion` >= this value.
export const WEACPX_PLUGIN_MIN_CORE_VERSION = "0.5.0" as const;

const SEMVER_RE = /^(\d+)\.(\d+)\.(\d+)$/;

// For compatibility checks we treat a prerelease build (e.g. `0.4.0-beta.0`)
// as its base release (`0.4.0`). Plugins built against the upcoming stable
// version need to load on its prereleases without authors having to declare
// every prerelease tag in `minWeacpxVersion`.
export function normalizeCoreVersionForCompat(version: string): string {
  const dashIdx = version.indexOf("-");
  const plusIdx = version.indexOf("+");
  const cutPositions = [dashIdx, plusIdx].filter((i) => i >= 0);
  if (cutPositions.length === 0) return version;
  return version.slice(0, Math.min(...cutPositions));
}

export function compareSemver(a: string, b: string): -1 | 0 | 1 {
  const lhs = parseSemverStrict(a);
  const rhs = parseSemverStrict(b);
  for (let i = 0; i < 3; i += 1) {
    if (lhs[i]! < rhs[i]!) return -1;
    if (lhs[i]! > rhs[i]!) return 1;
  }
  return 0;
}

function parseSemverStrict(value: string): [number, number, number] {
  const match = SEMVER_RE.exec(value);
  if (!match) throw new Error(`malformed semver: ${value}`);
  return [Number(match[1]!), Number(match[2]!), Number(match[3]!)];
}

interface ParsedRange {
  kind: "exact" | "gte" | "caret";
  base: [number, number, number];
  raw: string;
}

function parseRange(requirement: string): ParsedRange {
  const trimmed = requirement.trim();
  if (!trimmed) throw new Error("empty version requirement");
  if (trimmed.startsWith(">=")) {
    return { kind: "gte", base: parseSemverStrict(trimmed.slice(2).trim()), raw: trimmed };
  }
  if (trimmed.startsWith("^")) {
    return { kind: "caret", base: parseSemverStrict(trimmed.slice(1).trim()), raw: trimmed };
  }
  if (trimmed.startsWith(">") || trimmed.startsWith("<") || trimmed.startsWith("~") || trimmed.includes(" ")) {
    throw new Error(`unsupported version requirement: ${requirement}`);
  }
  return { kind: "exact", base: parseSemverStrict(trimmed), raw: trimmed };
}

export function isVersionSatisfied(current: string, requirement: string): boolean {
  const range = parseRange(requirement);
  const cur = parseSemverStrict(current);
  switch (range.kind) {
    case "exact":
      return cur[0] === range.base[0] && cur[1] === range.base[1] && cur[2] === range.base[2];
    case "gte":
      return cmpTuple(cur, range.base) >= 0;
    case "caret":
      // Match npm semver caret: same leftmost non-zero element.
      // ^1.2.3 := >=1.2.3 <2.0.0
      // ^0.3.3 := >=0.3.3 <0.4.0  (because major is 0)
      // ^0.0.3 := >=0.0.3 <0.0.4  (because major and minor are 0)
      if (cmpTuple(cur, range.base) < 0) return false;
      if (range.base[0] !== 0) return cur[0] === range.base[0];
      if (range.base[1] !== 0) return cur[0] === 0 && cur[1] === range.base[1];
      return cur[0] === 0 && cur[1] === 0 && cur[2] === range.base[2];
  }
}

function cmpTuple(a: [number, number, number], b: [number, number, number]): -1 | 0 | 1 {
  for (let i = 0; i < 3; i += 1) {
    if (a[i]! < b[i]!) return -1;
    if (a[i]! > b[i]!) return 1;
  }
  return 0;
}

export interface PluginCompatibilityMetadata {
  apiVersion?: unknown;
  minWeacpxVersion?: unknown;
  compatibleWeacpxVersions?: unknown;
}

export interface PluginCompatibilityContext {
  packageName: string;
  currentWeacpxVersion: string;
}

// Validates the compatibility envelope of a plugin. Throws an Error with a
// user-actionable message; the caller should print the message verbatim.
//
// The envelope checks API version first (since a wrong API version is the
// strongest signal) then optional core-version constraints.
export function validatePluginCompatibility(
  metadata: PluginCompatibilityMetadata,
  context: PluginCompatibilityContext,
): void {
  const { packageName, currentWeacpxVersion } = context;

  const apiVersion = metadata.apiVersion;
  if (typeof apiVersion !== "number") {
    throw new Error(`插件 ${packageName} 缺少必需字段 apiVersion`);
  }
  if (!WEACPX_PLUGIN_API_SUPPORTED_VERSIONS.includes(apiVersion)) {
    const supported = WEACPX_PLUGIN_API_SUPPORTED_VERSIONS.join(", ");
    throw new Error(
      `插件 ${packageName} 使用不支持的 apiVersion ${apiVersion}; supported: ${supported}; ` +
      `请安装与当前 weacpx 兼容的插件版本 (install a compatible plugin)`,
    );
  }

  if (!currentWeacpxVersion || currentWeacpxVersion === "unknown") {
    return; // can't decide core-version compatibility; skip rather than block on a guess.
  }

  const normalizedCurrent = normalizeCoreVersionForCompat(currentWeacpxVersion);

  if (metadata.minWeacpxVersion !== undefined) {
    if (typeof metadata.minWeacpxVersion !== "string") {
      throw new Error(`插件 ${packageName} 元数据非法：minWeacpxVersion 必须是字符串 (invalid plugin metadata)`);
    }
    let satisfied: boolean;
    try {
      satisfied = compareSemver(normalizedCurrent, metadata.minWeacpxVersion) >= 0;
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      throw new Error(`插件 ${packageName} 元数据非法：minWeacpxVersion (${detail}) (invalid plugin metadata)`);
    }
    if (!satisfied) {
      throw new Error(
        `插件 ${packageName} requires weacpx >=${metadata.minWeacpxVersion}; ` +
        `current is ${currentWeacpxVersion}; upgrade weacpx`,
      );
    }
  }

  if (metadata.compatibleWeacpxVersions !== undefined) {
    if (typeof metadata.compatibleWeacpxVersions !== "string") {
      throw new Error(`插件 ${packageName} 元数据非法：compatibleWeacpxVersions 必须是字符串 (invalid plugin metadata)`);
    }
    let satisfied: boolean;
    try {
      satisfied = isVersionSatisfied(normalizedCurrent, metadata.compatibleWeacpxVersions);
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      throw new Error(`插件 ${packageName} 元数据非法：compatibleWeacpxVersions (${detail}) (invalid plugin metadata)`);
    }
    if (!satisfied) {
      throw new Error(
        `插件 ${packageName} requires weacpx ${metadata.compatibleWeacpxVersions}; ` +
        `current is ${currentWeacpxVersion}; upgrade weacpx`,
      );
    }
  }
}
