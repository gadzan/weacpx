import { parseStringFlag } from "./parse-string-flag";

export function parseCoordinatorSession(
  args: string[],
  env: NodeJS.ProcessEnv = process.env,
): string | null {
  return parseStringFlag(args, env, {
    flag: "--coordinator-session",
    envKey: "WEACPX_COORDINATOR_SESSION",
  });
}
