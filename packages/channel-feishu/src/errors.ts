/**
 * Shared Feishu/Lark error helpers.
 *
 * Centralizes the `{ code, msg, response: { data: { code, msg } } }` shape
 * the @larksuiteoapi/node-sdk throws so domain modules (message-unavailable,
 * permission-error, future rate-limit handling) all parse the envelope the
 * same way. New error codes go in {@link FeishuErrorCode}.
 */

export const FeishuErrorCode = {
  /** Message has been recalled. */
  MessageRecalled: 230011,
  /** Message has been deleted. */
  MessageDeleted: 231003,
  /** App is missing one or more required API scopes. */
  AppScopeMissing: 99991672,
} as const;

export type FeishuErrorCodeValue = (typeof FeishuErrorCode)[keyof typeof FeishuErrorCode];

const TERMINAL_MESSAGE_CODES: ReadonlySet<number> = new Set([
  FeishuErrorCode.MessageRecalled,
  FeishuErrorCode.MessageDeleted,
]);

export function isTerminalMessageApiCode(code: unknown): code is number {
  return typeof code === "number" && TERMINAL_MESSAGE_CODES.has(code);
}

export function extractFeishuApiCode(error: unknown): number | undefined {
  if (!error || typeof error !== "object") return undefined;
  const rec = error as { code?: unknown; response?: { data?: { code?: unknown } } };
  if (typeof rec.code === "number") return rec.code;
  const nested = rec.response?.data?.code;
  if (typeof nested === "number") return nested;
  return undefined;
}

export function extractFeishuMessage(error: unknown): string {
  if (!error || typeof error !== "object") return "";
  const rec = error as {
    msg?: unknown;
    message?: unknown;
    response?: { data?: { msg?: unknown } };
  };
  if (typeof rec.msg === "string") return rec.msg;
  const nested = rec.response?.data?.msg;
  if (typeof nested === "string") return nested;
  if (typeof rec.message === "string") return rec.message;
  return "";
}
