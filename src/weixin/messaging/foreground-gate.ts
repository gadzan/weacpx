// A turn is "foreground" when the session it is bound to is still the chat's
// live current_session. The predicate is evaluated at SEND time (not turn start)
// so a turn that gets backgrounded mid-flight stops delivering, and one switched
// back to resumes delivering.
export function shouldDeliverSegment(isForeground: (() => boolean) | undefined): boolean {
  return isForeground ? isForeground() : true;
}

export type FinalDisposition = "send" | "store" | "drop";

// Decide what to do with a turn's final output:
//   - foreground              → "send" through the normal quota-gated path
//   - backgrounded + can store → "store" via onBackgroundFinal
//   - backgrounded + cannot store → "drop" (NEVER fall through to a foreground
//     send, which would leak a background session's answer into the wrong chat)
export function resolveFinalDisposition(isForeground: boolean, canStore: boolean): FinalDisposition {
  if (isForeground) return "send";
  return canStore ? "store" : "drop";
}
