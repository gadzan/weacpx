import { parseStringFlag } from "./parse-string-flag";

export function parseSourceHandle(
  args: string[],
  env: NodeJS.ProcessEnv = process.env,
): string | null {
  return parseStringFlag(args, env, {
    flag: "--source-handle",
    envKey: "WEACPX_SOURCE_HANDLE",
  });
}
