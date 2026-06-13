import { expect, test } from "bun:test";

import { createControlEventBus, type ControlEvent } from "../../../src/control/control-event-bus";

test("delivers events to subscribers until unsubscribed", () => {
  const bus = createControlEventBus();
  const seen: ControlEvent[] = [];
  const unsubscribe = bus.subscribe((event) => seen.push(event));

  bus.emit({ type: "sessions-changed" });
  expect(seen).toEqual([{ type: "sessions-changed" }]);

  unsubscribe();
  bus.emit({ type: "orchestration-changed" });
  expect(seen).toHaveLength(1);
});

test("a throwing listener does not break other listeners", () => {
  const bus = createControlEventBus();
  const seen: string[] = [];
  bus.subscribe(() => {
    throw new Error("boom");
  });
  bus.subscribe((event) => seen.push(event.type));

  bus.emit({ type: "scheduled-changed", chatKey: "relay:acct-1" });
  expect(seen).toEqual(["scheduled-changed"]);
});
