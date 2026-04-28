/**
 * Structured error type for failed Weixin API calls.
 *
 * Two ways the API signals failure:
 * 1. Non-2xx HTTP status (network / gateway).
 * 2. 2xx HTTP with a JSON body whose `errcode` is non-zero (logical failure,
 *    e.g. quota exhausted, invalid context_token, expired session). The
 *    original implementation only handled case 1, so logical failures
 *    appeared as silent successes — that is why "10 reply quota exhausted"
 *    never showed up in the logs.
 */
export class WeixinSendError extends Error {
  readonly endpoint: string;
  readonly httpStatus: number;
  readonly errcode?: number;
  readonly errmsg?: string;
  readonly textPreview: string;

  constructor(input: {
    endpoint: string;
    httpStatus: number;
    errcode?: number;
    errmsg?: string;
    textPreview: string;
  }) {
    super(formatMessage(input));
    this.name = "WeixinSendError";
    this.endpoint = input.endpoint;
    this.httpStatus = input.httpStatus;
    if (input.errcode !== undefined) {
      this.errcode = input.errcode;
    }
    if (input.errmsg !== undefined) {
      this.errmsg = input.errmsg;
    }
    this.textPreview = input.textPreview;
  }
}

function formatMessage(input: {
  endpoint: string;
  httpStatus: number;
  errcode?: number;
  errmsg?: string;
  textPreview: string;
}): string {
  const parts = [`${input.endpoint} httpStatus=${input.httpStatus}`];
  if (input.errcode !== undefined) {
    parts.push(`errcode=${input.errcode}`);
  }
  if (input.errmsg) {
    parts.push(`errmsg=${truncate(input.errmsg, 200)}`);
  }
  if (input.textPreview && input.errmsg === undefined) {
    parts.push(`body=${truncate(input.textPreview, 200)}`);
  }
  return parts.join(" ");
}

function truncate(text: string, max: number): string {
  if (text.length <= max) return text;
  return `${text.slice(0, max)}…`;
}

/** Type guard for callers that need to read structured fields. */
export function isWeixinSendError(error: unknown): error is WeixinSendError {
  return error instanceof WeixinSendError;
}

/**
 * Extract structured fields from any error for logging context.
 * Returns sparse object so spreading into log context only adds what we know.
 */
export function describeWeixinSendError(
  error: unknown,
): {
  message: string;
  errcode?: number;
  errmsg?: string;
  httpStatus?: number;
  endpoint?: string;
  textPreview?: string;
} {
  if (isWeixinSendError(error)) {
    return {
      message: error.message,
      ...(error.errcode !== undefined ? { errcode: error.errcode } : {}),
      ...(error.errmsg !== undefined ? { errmsg: error.errmsg } : {}),
      httpStatus: error.httpStatus,
      endpoint: error.endpoint,
      textPreview: error.textPreview,
    };
  }
  return {
    message: error instanceof Error ? error.message : String(error),
  };
}
