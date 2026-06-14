import { expect, test } from "bun:test";
import type { ControlEventDto, ToolStepDto } from "../../../../packages/relay-protocol/src/dtos";

test("ToolStepDto and the new ControlEventDto variants are assignable", () => {
  const step: ToolStepDto = {
    toolCallId: "t1",
    toolName: "Edit",
    kind: "edit",
    status: "success",
    title: "src/x.ts",
    detail: { type: "diff", path: "src/x.ts", oldText: "a", newText: "b" },
  };
  const events: ControlEventDto[] = [
    { type: "turn-started", chatKey: "c", sessionAlias: "s" },
    { type: "tool-event", chatKey: "c", sessionAlias: "s", step },
    { type: "turn-thought", chatKey: "c", sessionAlias: "s", chunk: "x" },
    { type: "turn-finished", chatKey: "c", sessionAlias: "s", ok: false, cancelled: true },
  ];
  expect(events.length).toBe(4);
  expect(step.detail?.type).toBe("diff");
});
