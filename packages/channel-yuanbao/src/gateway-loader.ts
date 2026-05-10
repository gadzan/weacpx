import { pathToFileURL } from "node:url";
import path from "node:path";
import type { YuanbaoChannelConfig } from "./config.js";
import type { YuanbaoGateway, YuanbaoGatewayFactory } from "./types.js";

function toImportSpecifier(specifier: string): string {
  if (specifier.startsWith("file://")) return specifier;
  if (specifier.startsWith(".") || specifier.startsWith("/") || specifier.startsWith("~")) {
    const expanded = specifier.startsWith("~/") ? path.join(process.env.HOME ?? "", specifier.slice(2)) : specifier;
    return pathToFileURL(path.resolve(expanded)).href;
  }
  return specifier;
}

export async function loadYuanbaoGatewayFromModule(specifier: string, config: YuanbaoChannelConfig): Promise<YuanbaoGateway> {
  const mod = await import(toImportSpecifier(specifier)) as {
    default?: YuanbaoGatewayFactory | YuanbaoGateway;
    createYuanbaoGateway?: YuanbaoGatewayFactory;
  };
  const exported = mod.createYuanbaoGateway ?? mod.default;
  if (typeof exported === "function") {
    return (exported as YuanbaoGatewayFactory)({ config });
  }
  if (exported && typeof exported === "object") {
    const candidate = exported as Partial<YuanbaoGateway>;
    if (typeof candidate.start === "function" && typeof candidate.sendText === "function") {
      return candidate as YuanbaoGateway;
    }
  }
  throw new Error(`Yuanbao gateway module ${specifier} must export createYuanbaoGateway() or a default gateway with start() and sendText()`);
}
