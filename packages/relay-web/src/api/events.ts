import { parseWebServerEvent, decodeEnvelope, type WebServerEvent } from "@ganglion/xacpx-relay-protocol";

/** Connects to the relay /ws fan-out and invokes `onEvent` for each web event. Auto-reconnects. */
export function connectEvents(onEvent: (event: WebServerEvent) => void, onStatus?: (online: boolean) => void): () => void {
  let socket: WebSocket | null = null;
  let closed = false;
  let retry = 0;

  const open = () => {
    const proto = location.protocol === "https:" ? "wss" : "ws";
    socket = new WebSocket(`${proto}://${location.host}/ws`);
    socket.onmessage = (e) => {
      const decoded = decodeEnvelope(String(e.data));
      if (!decoded.ok) return;
      const event = parseWebServerEvent(decoded.envelope);
      if (event) onEvent(event);
    };
    socket.onopen = () => { retry = 0; onStatus?.(true); };
    socket.onclose = () => {
      onStatus?.(false);
      if (closed) return;
      retry = Math.min(retry + 1, 6);
      setTimeout(open, 250 * 2 ** (retry - 1));
    };
  };

  open();
  return () => { closed = true; socket?.close(); };
}
