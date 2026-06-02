import { describe, it, expect } from "bun:test";
import { resolveLocale, isLocale } from "../../../src/i18n/resolve-locale";

describe("resolveLocale", () => {
  it("prefers a valid config language", () => {
    expect(resolveLocale({ configLanguage: "zh", env: { LANG: "en_US.UTF-8" } })).toBe("zh");
  });
  it("ignores an invalid config language and falls back to env", () => {
    expect(resolveLocale({ configLanguage: "fr", env: { LANG: "en_US.UTF-8" } })).toBe("en");
  });
  it("detects zh from LANG", () => {
    expect(resolveLocale({ env: { LANG: "zh_CN.UTF-8" } })).toBe("zh");
  });
  it("prefers LC_ALL over LANG", () => {
    expect(resolveLocale({ env: { LC_ALL: "zh_CN.UTF-8", LANG: "en_US.UTF-8" } })).toBe("zh");
  });
  it("detects zh from LC_MESSAGES when LC_ALL is unset", () => {
    expect(resolveLocale({ env: { LC_MESSAGES: "zh_TW.UTF-8" } })).toBe("zh");
  });
  it("defaults to en when nothing matches", () => {
    expect(resolveLocale({ env: {} })).toBe("en");
  });
  it("isLocale guards values", () => {
    expect(isLocale("en")).toBe(true);
    expect(isLocale("zh")).toBe(true);
    expect(isLocale("fr")).toBe(false);
    expect(isLocale(undefined)).toBe(false);
  });
});
