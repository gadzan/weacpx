export type BridgeMethod = "ping" | "shutdown" | "updatePermissionPolicy" | "ensureSession" | "hasSession" | "prompt" | "setMode" | "cancel" | "removeSession";

export interface BridgeRequest {
  id: string;
  method: BridgeMethod;
  params: Record<string, unknown>;
}

export type EnsureSessionProgressStage = "spawn" | "initializing" | "ready";
export type EnsureSessionProgress =
  | EnsureSessionProgressStage
  | { kind: "note"; text: string };
export type EnsureSessionErrorKind = "missing_optional_dep" | "generic";

export interface MissingOptionalDepErrorData {
  package: string;
  parentPackagePath: string | null;
}

export interface BridgeSuccessResponse<TResult = unknown> {
  id: string;
  ok: true;
  result: TResult;
}

export interface BridgeErrorResponse {
  id: string;
  ok: false;
  error: {
    code: string;
    message: string;
    kind?: EnsureSessionErrorKind;
    data?: MissingOptionalDepErrorData;
    details?: {
      exitCode?: number;
      stdout?: string;
      stderr?: string;
    };
  };
}

export interface BridgePromptSegmentEvent {
  id: string;
  event: "prompt.segment";
  text: string;
}

export interface BridgeSessionProgressEvent {
  id: string;
  event: "session.progress";
  stage: EnsureSessionProgressStage;
}

export interface BridgeSessionNoteEvent {
  id: string;
  event: "session.note";
  text: string;
}

export type BridgeMessage<TResult = unknown> =
  | BridgeSuccessResponse<TResult>
  | BridgeErrorResponse
  | BridgePromptSegmentEvent
  | BridgeSessionProgressEvent
  | BridgeSessionNoteEvent;
export type BridgeResponse<TResult = unknown> = BridgeSuccessResponse<TResult> | BridgeErrorResponse;

export function encodeBridgeRequest(request: BridgeRequest): string {
  return `${JSON.stringify(request)}\n`;
}

export function encodeBridgePromptSegmentEvent(event: BridgePromptSegmentEvent): string {
  return `${JSON.stringify(event)}\n`;
}

export function encodeBridgeSessionProgressEvent(event: BridgeSessionProgressEvent): string {
  return `${JSON.stringify(event)}\n`;
}

export function encodeBridgeSessionNoteEvent(event: BridgeSessionNoteEvent): string {
  return `${JSON.stringify(event)}\n`;
}
