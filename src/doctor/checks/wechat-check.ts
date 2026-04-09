import { listWeixinAccountIds, resolveWeixinAccount } from "../../weixin/index";
import type { DoctorCheckResult } from "../doctor-types";

export interface WechatCheckOptions {
  verbose?: boolean;
}

type ResolvedWeixinAccount = ReturnType<typeof resolveWeixinAccount>;
type AccountEntry = { accountId: string; account: ResolvedWeixinAccount };
type AccountErrorEntry = { accountId: string; error: string };

export async function checkWechat(options: WechatCheckOptions = {}): Promise<DoctorCheckResult> {
  const ids = listWeixinAccountIds();
  const accounts: Array<AccountEntry | AccountErrorEntry> = ids.map((accountId) => {
    try {
      return {
        accountId,
        account: resolveWeixinAccount(accountId),
      };
    } catch (error) {
      return {
        accountId,
        error: formatError(error),
      };
    }
  });
  const configuredAccount = accounts.find((entry): entry is AccountEntry => "account" in entry && entry.account.configured);
  const loggedIn = Boolean(configuredAccount);

  if (!loggedIn) {
    return {
      id: "wechat",
      label: "WeChat",
      severity: "warn",
      summary: "wechat is not logged in",
      details: buildVerboseDetails(false, options.verbose, accounts),
      suggestions: ["weacpx login"],
    };
  }

  return {
    id: "wechat",
    label: "WeChat",
    severity: "pass",
    summary: "wechat is logged in",
    details: buildVerboseDetails(true, options.verbose, accounts),
  };
}

function buildVerboseDetails(
  loggedIn: boolean,
  verbose: boolean | undefined,
  accounts: Array<AccountEntry | AccountErrorEntry>,
): string[] | undefined {
  if (!verbose) {
    return undefined;
  }

  const details: string[] = [];
  details.push(`loggedIn: ${loggedIn}`);
  details.push(`accountIds: ${accounts.length > 0 ? accounts.map((entry) => entry.accountId).join(", ") : "(none)"}`);
  for (const entry of accounts) {
    if ("account" in entry) {
      details.push(`account[${entry.account.accountId}].configured: ${entry.account.configured}`);
      details.push(`account[${entry.account.accountId}].baseUrl: ${entry.account.baseUrl}`);
      continue;
    }

    details.push(`account[${entry.accountId}].resolveError: ${entry.error ?? "unknown"}`);
  }

  return details;
}

function formatError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
