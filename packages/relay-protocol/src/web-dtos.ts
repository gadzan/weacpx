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

const CONTROL_EVENT_TYPES = new Set([
  "turn-output",
  "turn-finished",
  "sessions-changed",
  "scheduled-changed",
  "orchestration-changed",
]);

/** Deep-validate an inner ControlEventDto: discriminant + per-variant required fields. */
function validControlEvent(e: unknown): boolean {
  if (typeof e !== "object" || e === null) return false;
  const c = e as Record<string, unknown>;
  if (typeof c.type !== "string" || !CONTROL_EVENT_TYPES.has(c.type)) return false;
  if (c.type === "turn-output")
    return typeof c.chatKey === "string" && typeof c.sessionAlias === "string" && typeof c.chunk === "string";
  if (c.type === "turn-finished")
    return typeof c.chatKey === "string" && typeof c.sessionAlias === "string" && typeof c.ok === "boolean";
  if (c.type === "scheduled-changed") return typeof c.chatKey === "string";
  return true; // sessions-changed / orchestration-changed carry no extra required fields
}

const NOTICE_KINDS = new Set(["task-completion", "task-progress", "coordinator-message"]);

/** Deep-validate an inner InstanceNoticePayload: known kind + required text. */
function validNotice(n: unknown): boolean {
  if (typeof n !== "object" || n === null) return false;
  const c = n as Record<string, unknown>;
  return typeof c.kind === "string" && NOTICE_KINDS.has(c.kind) && typeof c.text === "string";
}

/** Parse + validate a relay→web push payload; returns null for any malformed envelope. */
export function parseWebServerEvent(envelope: RelayEnvelope): WebServerEvent | null {
  if (envelope.kind !== "event" || envelope.type !== WEB_EVENT_TYPE) return null;
  const payload = envelope.payload;
  if (typeof payload !== "object" || payload === null) return null;
  const candidate = payload as Record<string, unknown>;
  if (typeof candidate.instanceId !== "string") return null;
  if (typeof candidate.kind !== "string" || !WEB_EVENT_KINDS.has(candidate.kind)) return null;
  if (candidate.kind === "instance-status" && typeof candidate.online !== "boolean") return null;
  if (candidate.kind === "control-event" && !validControlEvent(candidate.event)) return null;
  if (candidate.kind === "notice" && !validNotice(candidate.notice)) return null;
  return payload as WebServerEvent;
}
