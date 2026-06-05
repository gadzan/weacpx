// Plugin compatibility primitives. Pure functions: no fs, no imports outside
// of types. The plugin loader, validator, and doctor reuse these to decide
// whether a plugin built for a given WeacpxPlugin API version and core
// version range is compatible with the running xacpx.

import { t } from "../i18n";

export const XACPX_PLUGIN_API_VERSION = 1 as const;
export const XACPX_PLUGIN_API_SUPPORTED_VERSIONS: readonly number[] = [1];

// Minimum core version that the current plugin API version corresponds to.
// First-party plugins should declare `minXacpxVersion` >= this value.
export const XACPX_PLUGIN_MIN_CORE_VERSION = "0.5.0" as const;

// Deprecated weacpx→xacpx aliases — kept for already-published plugins that
// import the old names from "xacpx/plugin-api".
export const WEACPX_PLUGIN_API_VERSION = XACPX_PLUGIN_API_VERSION;
export const WEACPX_PLUGIN_API_SUPPORTED_VERSIONS = XACPX_PLUGIN_API_SUPPORTED_VERSIONS;
export const WEACPX_PLUGIN_MIN_CORE_VERSION = XACPX_PLUGIN_MIN_CORE_VERSION;

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
  // Post-rename (weacpx→xacpx) aliases; preferred when present.
  minXacpxVersion?: unknown;
  compatibleXacpxVersions?: unknown;
}

export interface PluginCompatibilityContext {
  packageName: string;
  currentXacpxVersion: string;
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
  const { packageName, currentXacpxVersion } = context;

  const apiVersion = metadata.apiVersion;
  if (typeof apiVersion !== "number") {
    throw new Error(t().pluginCli.compatMissingApiVersion(packageName));
  }
  if (!XACPX_PLUGIN_API_SUPPORTED_VERSIONS.includes(apiVersion)) {
    const supported = XACPX_PLUGIN_API_SUPPORTED_VERSIONS.join(", ");
    throw new Error(t().pluginCli.compatUnsupportedApiVersion(packageName, apiVersion, supported));
  }

  if (!currentXacpxVersion || currentXacpxVersion === "unknown") {
    return; // can't decide core-version compatibility; skip rather than block on a guess.
  }

  const normalizedCurrent = normalizeCoreVersionForCompat(currentXacpxVersion);

  // weacpx→xacpx rename: prefer the new `*Xacpx*` fields, fall back to the
  // legacy `*Weacpx*` fields declared by already-published plugins.
  const minVersion = metadata.minXacpxVersion ?? metadata.minWeacpxVersion;
  const minVersionField = metadata.minXacpxVersion !== undefined ? "minXacpxVersion" : "minWeacpxVersion";
  if (minVersion !== undefined) {
    if (typeof minVersion !== "string") {
      throw new Error(t().pluginCli.compatInvalidMinVersion(packageName, minVersionField));
    }
    let satisfied: boolean;
    try {
      satisfied = compareSemver(normalizedCurrent, minVersion) >= 0;
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      throw new Error(t().pluginCli.compatInvalidMinVersionDetail(packageName, minVersionField, detail));
    }
    if (!satisfied) {
      throw new Error(t().pluginCli.compatMinVersionNotSatisfied(packageName, minVersion, currentXacpxVersion));
    }
  }

  const compatibleVersions = metadata.compatibleXacpxVersions ?? metadata.compatibleWeacpxVersions;
  const compatibleField =
    metadata.compatibleXacpxVersions !== undefined ? "compatibleXacpxVersions" : "compatibleWeacpxVersions";
  if (compatibleVersions !== undefined) {
    if (typeof compatibleVersions !== "string") {
      throw new Error(t().pluginCli.compatInvalidCompatibleVersions(packageName, compatibleField));
    }
    let satisfied: boolean;
    try {
      satisfied = isVersionSatisfied(normalizedCurrent, compatibleVersions);
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      throw new Error(t().pluginCli.compatInvalidCompatibleVersionsDetail(packageName, compatibleField, detail));
    }
    if (!satisfied) {
      throw new Error(t().pluginCli.compatCompatibleVersionsNotSatisfied(packageName, compatibleVersions, currentXacpxVersion));
    }
  }
}
