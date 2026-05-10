import * as Lark from "@larksuiteoapi/node-sdk";
import type { FeishuMessageClient } from "./send.js";

export interface FeishuLarkClientOptions {
  appId: string;
  appSecret: string;
  domain: string;
  injectedSdkClient?: FeishuMessageClient;
  injectedStartWS?: (handlers: Record<string, (data: unknown) => Promise<void> | void>, abortSignal?: AbortSignal) => Promise<void>;
  injectedProbeBot?: () => Promise<{ botOpenId?: string; botName?: string }>;
}

export interface FeishuLarkClient {
  sdk: FeishuMessageClient;
  probeBot(): Promise<{ botOpenId?: string; botName?: string }>;
  startWS(input: {
    handlers: Record<string, (data: unknown) => Promise<void> | void>;
    abortSignal?: AbortSignal;
  }): Promise<void>;
  stop(): void;
}

function resolveDomain(domain: string): unknown {
  if (domain === "lark") return Lark.Domain.Lark;
  if (domain === "feishu") return Lark.Domain.Feishu;
  return domain;
}

export function createFeishuLarkClient(options: FeishuLarkClientOptions): FeishuLarkClient {
  const sdk = options.injectedSdkClient ?? (new Lark.Client({
    appId: options.appId,
    appSecret: options.appSecret,
    appType: Lark.AppType.SelfBuild,
    domain: resolveDomain(options.domain) as never,
  }) as unknown as FeishuMessageClient);

  let wsClient: { close(params?: { force?: boolean }): void } | null = null;

  return {
    sdk,
    async probeBot() {
      if (options.injectedProbeBot) return await options.injectedProbeBot();
      const response = await (sdk as unknown as { request(input: unknown): Promise<{ data?: { pingBotInfo?: { botID?: string; botName?: string } } }> }).request({
        method: "POST",
        url: "/open-apis/bot/v1/openclaw_bot/ping",
        data: { needBotInfo: true },
      });
      return {
        botOpenId: response.data?.pingBotInfo?.botID,
        botName: response.data?.pingBotInfo?.botName,
      };
    },
    async startWS(input) {
      if (options.injectedStartWS) {
        await options.injectedStartWS(input.handlers, input.abortSignal);
        return;
      }
      const client = new Lark.WSClient({
        appId: options.appId,
        appSecret: options.appSecret,
        domain: resolveDomain(options.domain) as never,
      });
      wsClient = client;
      client.start({ eventDispatcher: new Lark.EventDispatcher({}).register(input.handlers as never) });
      if (input.abortSignal) {
        await new Promise<void>((resolve) => {
          if (input.abortSignal!.aborted) {
            client.close({ force: true });
            resolve();
            return;
          }
          input.abortSignal!.addEventListener("abort", () => {
            client.close({ force: true });
            resolve();
          }, { once: true });
        });
      }
    },
    stop() {
      if (wsClient) {
        wsClient.close({ force: true });
        wsClient = null;
      }
    },
  };
}
