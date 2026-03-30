export type BridgeMethod = "ping" | "shutdown" | "ensureSession" | "hasSession" | "prompt" | "cancel";

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

export type BridgeResponse<TResult = unknown> = BridgeSuccessResponse<TResult> | BridgeErrorResponse;

export function encodeBridgeRequest(request: BridgeRequest): string {
  return `${JSON.stringify(request)}\n`;
}
