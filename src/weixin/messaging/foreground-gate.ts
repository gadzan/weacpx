// A turn is "foreground" when the session it is bound to is still the chat's
// live current_session. The predicate is evaluated at SEND time (not turn start)
// so a turn that gets backgrounded mid-flight stops delivering, and one switched
// back to resumes delivering.
export function shouldDeliverSegment(isForeground: (() => boolean) | undefined): boolean {
  return isForeground ? isForeground() : true;
}
