export interface RelayChannelConfig {
  url: string;
  pairingToken?: string;
  name?: string;
}

export function parseRelayChannelConfig(options: Record<string, unknown> | undefined): RelayChannelConfig {
  const url = typeof options?.url === "string" ? options.url.trim() : "";
  if (!url) {
    throw new Error("relay channel requires options.url (the relay instance-gateway ws(s):// address)");
  }
  if (!url.startsWith("ws://") && !url.startsWith("wss://")) {
    throw new Error(`relay channel options.url must start with ws:// or wss://, got: ${url}`);
  }
  const config: RelayChannelConfig = { url };
  if (typeof options?.pairingToken === "string" && options.pairingToken.trim()) {
    config.pairingToken = options.pairingToken.trim();
  }
  if (typeof options?.name === "string" && options.name.trim()) {
    config.name = options.name.trim();
  }
  return config;
}
