// Prefix a "● " unread marker on a session's display name when it has an unread
// background result waiting to be replayed on /use switch-back.
export function decorateUnread(label: string, hasUnread: boolean): string {
  return hasUnread ? `● ${label}` : label;
}
