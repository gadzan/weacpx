export type BridgeMethod = "ping" | "shutdown" | "updatePermissionPolicy" | "ensureSession" | "hasSession" | "prompt" | "setMode" | "cancel";

export interface BridgeRequest {
  id: string;
  method: BridgeMethod;
  params: Record<string, unknown>;
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

export type BridgeMessage<TResult = unknown> =
  | BridgeSuccessResponse<TResult>
  | BridgeErrorResponse
  | BridgePromptSegmentEvent;
export type BridgeResponse<TResult = unknown> = BridgeSuccessResponse<TResult> | BridgeErrorResponse;

export function encodeBridgeRequest(request: BridgeRequest): string {
  return `${JSON.stringify(request)}\n`;
}

export function encodeBridgePromptSegmentEvent(event: BridgePromptSegmentEvent): string {
  return `${JSON.stringify(event)}\n`;
}
