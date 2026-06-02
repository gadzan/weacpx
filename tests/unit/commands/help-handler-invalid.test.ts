import { beforeEach, expect, test } from "bun:test";

import { handleInvalidCommand } from "../../../src/commands/handlers/help-handler";
import { setLocale, t } from "../../../src/i18n";

beforeEach(() => {
  setLocale("zh");
});

test("handleInvalidCommand shows the command's own help, not the session message", () => {
  const out = handleInvalidCommand("/delegate");
  // Should surface orchestration help (delegate is an alias of the orchestration topic)…
  expect(out.text).toContain(t().help.invalidCommandPrefix);
  expect(out.text).toContain("/delegate");
  // …and must NOT misdirect the user to session-creation syntax.
  expect(out.text).not.toContain(t().help.invalidCommandFallbackFormat);
});

test("handleInvalidCommand maps aliases to their topic (/dg -> orchestration)", () => {
  const out = handleInvalidCommand("/dg");
  expect(out.text).toContain(t().help.invalidCommandPrefix);
  expect(out.text.length).toBeGreaterThan(0);
});

test("handleInvalidCommand falls back to session-creation hint for commands without a topic", () => {
  // /use is recognized but has no dedicated help topic.
  const out = handleInvalidCommand("/use");
  expect(out.text).toContain(t().help.invalidCommandFallbackFormat);
});
