import type { WechatAgent } from "./wechat-types";

interface WeixinSdkModule {
  login: () => Promise<string>;
  start: (agent: WechatAgent) => Promise<void>;
}

export function buildWeixinSdkImportCandidates(
  explicitPath: string | undefined,
  _moduleUrl: string = import.meta.url,
): string[] {
  const candidates: string[] = [];
  if (explicitPath) {
    candidates.push(explicitPath);
  }

  candidates.push("weixin-agent-sdk");
  return candidates;
}

export function buildWeixinSdkSourceCandidates(
  explicitPath: string | undefined,
  _moduleUrl: string = import.meta.url,
): string[] {
  if (explicitPath) {
    return [explicitPath];
  }

  return [];
}

export async function loadWeixinSdk(): Promise<WeixinSdkModule> {
  const candidates = buildWeixinSdkImportCandidates(process.env.WEACPX_WEIXIN_SDK, import.meta.url);
  const errors: string[] = [];

  for (const candidate of candidates) {
    try {
      return (await import(candidate)) as WeixinSdkModule;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      errors.push(`${candidate}: ${message}`);
    }
  }

  throw new Error(
    [
      "Unable to load weixin-agent-sdk.",
      "Tried:",
      ...errors.map((entry) => `- ${entry}`),
      'Set WEACPX_WEIXIN_SDK to a local SDK entry file, or install the "weixin-agent-sdk" package.',
    ].join("\n"),
  );
}
