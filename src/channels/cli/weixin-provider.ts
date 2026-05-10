import type { ChannelCliInput, ChannelCliParseResult, ChannelCliProvider, ChannelCliIo, ChannelCliValidationIssue } from "./provider";
import type { ChannelRuntimeConfig } from "../../config/types";

export const weixinCliProvider: ChannelCliProvider = {
  type: "weixin",
  displayName: "Weixin",
  supportsLogin: true,

  parseAddArgs(args: string[]): ChannelCliParseResult {
    if (args.length > 0) return { ok: false, message: `unknown weixin options: ${args.join(" ")}` };
    return { ok: true, input: {} };
  },

  buildDefaultConfig(_input: ChannelCliInput): ChannelRuntimeConfig {
    return { id: "weixin", type: "weixin", enabled: true };
  },

  validateConfig(config: ChannelRuntimeConfig): ChannelCliValidationIssue[] {
    const issues: ChannelCliValidationIssue[] = [];
    if (config.id !== "weixin") issues.push({ kind: "invalid-config", message: "weixin channel id must be weixin" });
    if (config.type !== "weixin") issues.push({ kind: "invalid-config", message: "weixin channel type must be weixin" });
    return issues;
  },

  renderSummary(config: ChannelRuntimeConfig): string[] {
    return [`type: ${config.type}`, `enabled: ${config.enabled}`];
  },

  async promptForMissingFields(input: ChannelCliInput, _io: ChannelCliIo): Promise<ChannelCliInput> {
    return input;
  },
};
