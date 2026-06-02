import { describe, it, expect, afterEach } from "bun:test";
import { setLocale, getLocale, t } from "../../../src/i18n";

describe("i18n runtime", () => {
  afterEach(() => setLocale("en"));
  it("defaults to en", () => {
    expect(getLocale()).toBe("en");
    expect(t().common.localeName).toBe("English");
  });
  it("switches to zh", () => {
    setLocale("zh");
    expect(getLocale()).toBe("zh");
    expect(t().common.localeName).toBe("中文");
  });
});
