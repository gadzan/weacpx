import { encodeEnvelope, webEventEnvelope, type WebServerEvent } from "@ganglion/xacpx-relay-protocol";

export interface WebSocketLike {
  send(data: string): void;
  on(event: "close", listener: () => void): unknown;
}

/** Tracks authenticated browser sockets per account and fans events out to them. */
export class WebGateway {
  private readonly byAccount = new Map<string, Set<WebSocketLike>>();

  register(accountId: string, socket: WebSocketLike): void {
    const set = this.byAccount.get(accountId) ?? new Set<WebSocketLike>();
    set.add(socket);
    this.byAccount.set(accountId, set);
    socket.on("close", () => {
      set.delete(socket);
      if (set.size === 0) this.byAccount.delete(accountId);
    });
  }

  broadcast(accountId: string, event: WebServerEvent): void {
    const set = this.byAccount.get(accountId);
    if (!set) return;
    const data = encodeEnvelope(webEventEnvelope(event));
    for (const socket of set) socket.send(data);
  }
}
