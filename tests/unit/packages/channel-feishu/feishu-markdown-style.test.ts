import { expect, test } from "bun:test";

import { optimizeMarkdownStyle } from "../../../../packages/channel-feishu/src/card/markdown-style";

test("optimizeMarkdownStyle demotes headings when H1-H3 present", () => {
  const input = "# Big\n\n## Section\n\n### Sub";
  const out = optimizeMarkdownStyle(input);
  expect(out).toContain("#### Big");
  expect(out).toContain("##### Section");
  expect(out).toContain("##### Sub");
  expect(out).not.toMatch(/^# Big$/m);
});

test("optimizeMarkdownStyle leaves H4/H5 untouched when no H1-H3", () => {
  const input = "#### Already small\n\n##### Smaller";
  const out = optimizeMarkdownStyle(input);
  expect(out).toContain("#### Already small");
  expect(out).toContain("##### Smaller");
});

test("optimizeMarkdownStyle pads tables with <br>", () => {
  const input = "Intro text\n| a | b |\n|---|---|\n| 1 | 2 |\nMore prose";
  const out = optimizeMarkdownStyle(input);
  expect(out).toContain("<br>");
  expect(out).toContain("| a | b |");
  expect(out).toContain("| 1 | 2 |");
});

test("optimizeMarkdownStyle protects fenced code blocks", () => {
  const input = "Heading\n\n```js\nconst x = 1; // # not a heading\n```\n\nAfter";
  const out = optimizeMarkdownStyle(input);
  expect(out).toContain("const x = 1; // # not a heading");
  expect(out.indexOf("```js")).toBeGreaterThanOrEqual(0);
});

test("optimizeMarkdownStyle strips ![alt](non-image-key) references", () => {
  const input = "Look at this: ![cat](https://example.com/cat.jpg) and this: ![ok](img_abc) end";
  const out = optimizeMarkdownStyle(input);
  expect(out).not.toContain("example.com/cat.jpg");
  expect(out).toContain("![ok](img_abc)");
});

test("optimizeMarkdownStyle collapses 3+ blank lines to 2", () => {
  const input = "a\n\n\n\n\nb";
  expect(optimizeMarkdownStyle(input)).toBe("a\n\nb");
});

test("optimizeMarkdownStyle returns input on internal failure", () => {
  // The fail-safe wrapper guarantees we never throw to callers.
  expect(optimizeMarkdownStyle("")).toBe("");
});
