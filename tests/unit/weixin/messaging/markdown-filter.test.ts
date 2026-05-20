import { describe, it, expect } from "bun:test";
import { StreamingMarkdownFilter } from "../../../../src/weixin/messaging/markdown-filter.js";

function run(text: string): string {
  const f = new StreamingMarkdownFilter();
  return f.feed(text) + f.flush();
}

describe("StreamingMarkdownFilter", () => {
  it("preserves fenced code blocks verbatim", () => {
    const md = "前文\n```ts\nconst x = 1;\nconst y = 2;\n```\n后文\n";
    expect(run(md)).toBe(md);
  });

  it("preserves inline code with backticks", () => {
    expect(run("用 `foo()` 调用")).toBe("用 `foo()` 调用");
  });

  it("preserves tables (header + separator + rows)", () => {
    const md = "| a | b |\n| - | - |\n| 1 | 2 |\n";
    expect(run(md)).toBe(md);
  });

  it("preserves ** bold markers verbatim (both CJK and non-CJK)", () => {
    // The filter passes `**` through unchanged by design (matches openclaw).
    // Only `*`, `***`, `_`, `___` are CJK-stripped.
    expect(run("**中文加粗**")).toBe("**中文加粗**");
    expect(run("**bold**")).toBe("**bold**");
  });

  it("strips italic around CJK, keeps italic around non-CJK", () => {
    expect(run("*中文斜体*")).toBe("中文斜体");
    expect(run("*italic*")).toBe("*italic*");
  });

  it("strips *** bold-italic markers around CJK but keeps non-CJK", () => {
    expect(run("***中文***")).toBe("中文");
    expect(run("***bold italic***")).toBe("***bold italic***");
  });

  it("removes images entirely", () => {
    expect(run("前 ![alt](http://x) 后")).toBe("前  后");
  });

  it("strips H5/H6 markers but keeps content", () => {
    expect(run("##### 五级\n###### 六级\n")).toBe("五级\n六级\n");
  });

  it("works incrementally across feed() boundaries", () => {
    // Use *italic* (CJK-stripped) split across two feeds — verifies the
    // inline state machine survives feed() boundaries.
    const f = new StreamingMarkdownFilter();
    let out = "";
    out += f.feed("*中文");
    out += f.feed("斜体*");
    out += f.flush();
    expect(out).toBe("中文斜体");
  });

  it("does not eat trailing single * at EOF (leaves it intact)", () => {
    expect(run("text *")).toBe("text *");
  });
});
