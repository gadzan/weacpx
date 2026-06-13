import { RELAY_PROTOCOL_VERSION, type RelayEnvelope } from "./envelope.js";
import type { ControlEventDto } from "./dtos.js";
import type { InstanceNoticePayload } from "./messages.js";

/** Envelope `type` for every relay→web push. */
export const WEB_EVENT_TYPE = "web.event";

export type MessageDirection = "in" | "out";

/** A cached chat line echoed to the web client. */
export interface MessageRecordDto {
  instanceId: string;
  sessionAlias: string;
  direction: MessageDirection;
  text: string;
  createdAt: string;
}

/** Server→web push payloads (tagged with the originating instance). */
export type WebServerEvent =
  | { kind: "instance-status"; instanceId: string; online: boolean }
  | { kind: "control-event"; instanceId: string; event: ControlEventDto }
  | { kind: "notice"; instanceId: string; notice: InstanceNoticePayload };

/** Wrap a server→web push event in a relay envelope. */
export function webEventEnvelope(event: WebServerEvent): RelayEnvelope {
  return { protocolVersion: RELAY_PROTOCOL_VERSION, kind: "event", type: WEB_EVENT_TYPE, payload: event };
}

const WEB_EVENT_KINDS = new Set(["instance-status", "control-event", "notice"]);

/** Parse + validate a relay→web push payload; returns null for any malformed envelope. */
export function parseWebServerEvent(envelope: RelayEnvelope): WebServerEvent | null {
  if (envelope.kind !== "event" || envelope.type !== WEB_EVENT_TYPE) return null;
  const payload = envelope.payload;
  if (typeof payload !== "object" || payload === null) return null;
  const candidate = payload as Record<string, unknown>;
  if (typeof candidate.instanceId !== "string") return null;
  if (typeof candidate.kind !== "string" || !WEB_EVENT_KINDS.has(candidate.kind)) return null;
  if (candidate.kind === "instance-status" && typeof candidate.online !== "boolean") return null;
  if (candidate.kind === "control-event" && (typeof candidate.event !== "object" || candidate.event === null)) return null;
  if (candidate.kind === "notice" && (typeof candidate.notice !== "object" || candidate.notice === null)) return null;
  return payload as WebServerEvent;
}
