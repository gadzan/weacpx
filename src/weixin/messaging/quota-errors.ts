// Errors used to signal that an outbound message was not sent because the
// per-chat outbound quota is exhausted. Callers must distinguish this from a
// real send failure: deferred deliveries should be retried on the next wake,
// not marked as permanently failed.

export class QuotaDeferredError extends Error {
  readonly chatKey: string;

  constructor(input: { chatKey: string; reason: string }) {
    super(`outbound quota exhausted for "${input.chatKey}": ${input.reason}`);
    this.name = "QuotaDeferredError";
    this.chatKey = input.chatKey;
  }
}

export function isQuotaDeferredError(error: unknown): error is QuotaDeferredError {
  return error instanceof QuotaDeferredError;
}
