/**
 * Markdown style optimizer for Feishu rendering.
 *
 * Adapted from openclaw-lark's `card/markdown-style.ts`. Goals:
 * - Demote H1–H3 to H4–H5 so card headers don't dwarf the bot's reply
 * - Pad tables and code blocks with `<br>` so they don't collide with surrounding paragraphs
 * - Normalise list/cell spacing
 * - Protect fenced code block content from any of the above edits
 * - As a safety net, strip `![alt](non-image-key)` references that would
 *   trigger CardKit error 200570 if a stray URL escapes the image resolver.
 *
 * The function is fail-safe: if any rewrite throws, it returns the original text.
 */
export function optimizeMarkdownStyle(text: string, cardVersion = 2): string {
  try {
    let r = applyOptimizations(text, cardVersion);
    r = stripInvalidImageKeys(r);
    return r;
  } catch {
    return text;
  }
}

function applyOptimizations(text: string, cardVersion: number): string {
  // 1. Pull out fenced code blocks behind placeholders so subsequent regexes
  //    can't mangle them.
  const MARK = "___CB_";
  const codeBlocks: string[] = [];
  let r = text.replace(/(^|\n)(`{3,})([^\n]*)\n[\s\S]*?\n\2(?=\n|$)/g, (m, prefix = "") => {
    const block = m.slice(String(prefix).length);
    codeBlocks.push(block);
    return `${prefix}${MARK}${codeBlocks.length - 1}___`;
  });

  // 2. Heading demotion: H1→H4, H2–H6→H5. Only when original had H1–H3.
  //    Order matters — H2–H6 first, then H1, otherwise H4 from step 1 gets
  //    re-matched as H5.
  const hasH1toH3 = /^#{1,3} /m.test(text);
  if (hasH1toH3) {
    r = r.replace(/^#{2,6} (.+)$/gm, "##### $1");
    r = r.replace(/^# (.+)$/gm, "#### $1");
  }

  if (cardVersion >= 2) {
    // 3. Add paragraph spacing between consecutive demoted headings.
    r = r.replace(/^(#{4,5} .+)\n{1,2}(#{4,5} )/gm, "$1\n<br>\n$2");

    // 4a. Insert a blank line when prose flows straight into a table row.
    r = r.replace(/^([^|\n].*)\n(\|.+\|)/gm, "$1\n\n$2");
    // 4b. Insert <br> before a table that follows a blank line.
    r = r.replace(/\n\n((?:\|.+\|[^\S\n]*\n?)+)/g, "\n\n<br>\n\n$1");
    // 4c. Insert <br> after a table block (skip when followed by hr / heading / bold).
    r = r.replace(/((?:^\|.+\|[^\S\n]*\n?)+)/gm, (m, _table, offset) => {
      const after = r.slice(offset + m.length).replace(/^\n+/, "");
      if (!after || /^(---|#{4,5} |\*\*)/.test(after)) return m;
      return m + "\n<br>\n";
    });
    // 4d. Collapse double-blank between prose and the <br>+table pair.
    r = r.replace(/^((?!#{4,5} )(?!\*\*).+)\n\n(<br>)\n\n(\|)/gm, "$1\n$2\n$3");
    // 4d2. Same for a bold line preceding the table.
    r = r.replace(/^(\*\*.+)\n\n(<br>)\n\n(\|)/gm, "$1\n$2\n\n$3");
    // 4e. Tighten table → prose transition.
    r = r.replace(/(\|[^\n]*\n)\n(<br>\n)((?!#{4,5} )(?!\*\*))/gm, "$1$2$3");

    // 5. Restore code blocks, padded with <br> top and bottom.
    codeBlocks.forEach((block, i) => {
      r = r.replace(`${MARK}${i}___`, `\n<br>\n${block}\n<br>\n`);
    });
  } else {
    codeBlocks.forEach((block, i) => {
      r = r.replace(`${MARK}${i}___`, block);
    });
  }

  // 6. Compress 3+ consecutive newlines down to 2.
  r = r.replace(/\n{3,}/g, "\n\n");

  return r;
}

const IMAGE_RE = /!\[([^\]]*)\]\(([^)\s]+)\)/g;

/**
 * Strips `![alt](value)` where value isn't a Feishu `img_xxx` key. The image
 * resolver (Phase 3.1) replaces external URLs with `img_xxx` ahead of this;
 * anything left here is unresolved and would trigger CardKit error 200570
 * if sent, so we drop the entire image reference.
 */
function stripInvalidImageKeys(text: string): string {
  if (!text.includes("![")) return text;
  return text.replace(IMAGE_RE, (fullMatch, _alt, value: string) => {
    if (value.startsWith("img_")) return fullMatch;
    return "";
  });
}
