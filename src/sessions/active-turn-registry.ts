// Non-persisted, in-memory record of which (chatKey, sessionAlias) pairs have a
// turn currently executing. Used to tell the user "session X is still running"
// when they switch back before it finishes. Cleared naturally on process exit;
// it never needs to survive a restart.
export interface ActiveTurnRegistry {
  markActive(chatKey: string, alias: string): void;
  markInactive(chatKey: string, alias: string): void;
  isActive(chatKey: string, alias: string): boolean;
  /** True when any chat currently has a turn running for this alias. */
  isActiveAnywhere(alias: string): boolean;
}

export function createActiveTurnRegistry(): ActiveTurnRegistry {
  const byChat = new Map<string, Set<string>>();
  return {
    markActive(chatKey, alias) {
      const set = byChat.get(chatKey) ?? new Set<string>();
      set.add(alias);
      byChat.set(chatKey, set);
    },
    markInactive(chatKey, alias) {
      const set = byChat.get(chatKey);
      if (!set) return;
      set.delete(alias);
      if (set.size === 0) byChat.delete(chatKey);
    },
    isActive(chatKey, alias) {
      return byChat.get(chatKey)?.has(alias) ?? false;
    },
    isActiveAnywhere(alias) {
      for (const set of byChat.values()) {
        if (set.has(alias)) return true;
      }
      return false;
    },
  };
}
