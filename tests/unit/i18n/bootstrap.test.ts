import { describe, it, expect, afterEach } from "bun:test";
import { setLocale, getLocale, resolveLocale } from "../../../src/i18n";

afterEach(() => setLocale("en"));

describe("entrypoint locale bootstrap", () => {
  it("resolveLocale drives setLocale from config language", () => {
    setLocale(resolveLocale({ configLanguage: "zh", env: {} }));
    expect(getLocale()).toBe("zh");
  });
  it("falls back to system locale when config language absent", () => {
    setLocale(resolveLocale({ configLanguage: undefined, env: { LANG: "zh_CN.UTF-8" } }));
    expect(getLocale()).toBe("zh");
  });
});
