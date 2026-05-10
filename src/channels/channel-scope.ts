const KNOWN_CHANNEL_IDS = new Set(["weixin"]);

export function registerKnownChannelId(channelId: string): void {
  const normalized = channelId.trim();
  if (!normalized || normalized.includes(":")) {
    throw new Error("channel id must be non-empty and must not contain ':'");
  }
  KNOWN_CHANNEL_IDS.add(normalized);
}

export function listKnownChannelIds(): string[] {
  return Array.from(KNOWN_CHANNEL_IDS);
}

export function getChannelIdFromChatKey(chatKey: string): string {
  const first = chatKey.split(":", 1)[0];
  return first && KNOWN_CHANNEL_IDS.has(first) ? first : "weixin";
}

export function isLegacyWeixinChatKey(chatKey: string): boolean {
  return getChannelIdFromChatKey(chatKey) === "weixin" && !chatKey.startsWith("weixin:");
}

export function toInternalSessionAlias(channelId: string, displayAlias: string): string {
  const normalized = displayAlias.trim();
  if (normalized.length === 0) {
    throw new Error("display session alias must be non-empty");
  }
  if (normalized.startsWith(`${channelId}:`)) {
    return normalized;
  }
  return `${channelId}:${normalized}`;
}

export function toDisplaySessionAlias(internalAlias: string): string {
  const [first, ...rest] = internalAlias.split(":");
  if (first && KNOWN_CHANNEL_IDS.has(first) && rest.length > 0) {
    return rest.join(":");
  }
  return internalAlias;
}

export function isSessionAliasVisibleInChannel(alias: string, channelId: string): boolean {
  const [first] = alias.split(":", 1);
  if (first && KNOWN_CHANNEL_IDS.has(first)) {
    return first === channelId;
  }
  return channelId === "weixin";
}

export function resolveSessionAliasForInput(
  channelId: string,
  displayAlias: string,
  existingAliases: Iterable<string>,
): string {
  const normalized = displayAlias.trim();
  if (normalized.length === 0) {
    throw new Error("display session alias must be non-empty");
  }
  if (normalized.startsWith(`${channelId}:`)) {
    return normalized;
  }
  const scopedAlias = toInternalSessionAlias(channelId, normalized);
  for (const alias of existingAliases) {
    if (alias === scopedAlias) return scopedAlias;
  }
  if (channelId === "weixin") {
    for (const alias of existingAliases) {
      if (alias === normalized) return alias;
    }
  }
  return scopedAlias;
}

export function buildDefaultTransportSession(channelId: string, displayAlias: string): string {
  const normalized = displayAlias.trim();
  if (normalized.length === 0) {
    throw new Error("display session alias must be non-empty");
  }
  return channelId === "weixin" ? normalized : toInternalSessionAlias(channelId, normalized);
}
