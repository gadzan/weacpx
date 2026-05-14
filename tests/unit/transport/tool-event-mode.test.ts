import { describe, expect, test } from "bun:test";
import { resolveToolEventMode } from "../../../src/transport/tool-event-mode.js";

const noop = async () => {};

describe("resolveToolEventMode", () => {
  describe("explicit toolEventMode always wins", () => {
    test("explicit 'text' wins even with onToolEvent", () => {
      expect(resolveToolEventMode({ toolEventMode: "text", onToolEvent: noop })).toBe("text");
    });

    test("explicit 'structured' wins even with onToolEvent", () => {
      expect(resolveToolEventMode({ toolEventMode: "structured", onToolEvent: noop })).toBe(
        "structured",
      );
    });

    test("explicit 'both' wins even with onToolEvent", () => {
      expect(resolveToolEventMode({ toolEventMode: "both", onToolEvent: noop })).toBe("both");
    });

    test("explicit 'text' wins without onToolEvent", () => {
      expect(resolveToolEventMode({ toolEventMode: "text" })).toBe("text");
    });

    test("explicit 'structured' wins without onToolEvent", () => {
      expect(resolveToolEventMode({ toolEventMode: "structured" })).toBe("structured");
    });

    test("explicit 'both' wins without onToolEvent", () => {
      expect(resolveToolEventMode({ toolEventMode: "both" })).toBe("both");
    });
  });

  describe("fallback rules", () => {
    test("onToolEvent present => 'structured'", () => {
      expect(resolveToolEventMode({ onToolEvent: noop })).toBe("structured");
    });

    test("nothing provided => 'text'", () => {
      expect(resolveToolEventMode({})).toBe("text");
    });

    test("undefined input => 'text'", () => {
      expect(resolveToolEventMode(undefined)).toBe("text");
    });
  });
});
