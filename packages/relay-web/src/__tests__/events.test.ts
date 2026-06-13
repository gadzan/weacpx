import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { connectEvents } from "../api/events";

class FakeWS {
  static instances: FakeWS[] = [];
  onopen: (() => void) | null = null;
  onclose: (() => void) | null = null;
  onmessage: ((e: { data: string }) => void) | null = null;
  close = vi.fn(() => this.onclose?.());
  constructor(public url: string) { FakeWS.instances.push(this); }
}

describe("connectEvents", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    FakeWS.instances = [];
    vi.stubGlobal("WebSocket", FakeWS as never);
    vi.stubGlobal("location", { protocol: "http:", host: "x" } as never);
  });
  afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });

  it("does not reconnect after the disposer runs during backoff", () => {
    const dispose = connectEvents(() => {});
    FakeWS.instances[0].onclose?.();   // drop → schedules reconnect timer
    dispose();                          // teardown during backoff window
    vi.runOnlyPendingTimers();          // any pending reconnect fires
    expect(FakeWS.instances).toHaveLength(1); // NO second socket created
  });

  it("reports status across drop and reopen", () => {
    const status: boolean[] = [];
    connectEvents(() => {}, (o) => status.push(o));
    FakeWS.instances[0].onopen?.();
    FakeWS.instances[0].onclose?.();
    vi.runOnlyPendingTimers();          // reconnect fires → new socket
    FakeWS.instances[1]?.onopen?.();
    expect(status).toEqual([true, false, true]);
  });
});
