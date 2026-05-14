import { parseStringFlag } from "./parse-string-flag";

export function parseCoordinatorWorkspace(
  args: string[],
  env: NodeJS.ProcessEnv = process.env,
): string | null {
  return parseStringFlag(args, env, {
    flag: "--workspace",
    envKey: "WEACPX_COORDINATOR_WORKSPACE",
  });
}
