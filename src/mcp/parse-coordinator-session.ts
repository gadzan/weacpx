export function parseCoordinatorSession(
  args: string[],
  env: NodeJS.ProcessEnv = process.env,
): string | null {
  let fromFlag: string | null = null;

  for (let index = 0; index < args.length - 1; index += 1) {
    if (args[index] === "--coordinator-session") {
      fromFlag = args[index + 1] ?? null;
    }
  }

  const trimmedFlag = fromFlag?.trim();
  if (trimmedFlag && trimmedFlag.length > 0) {
    return trimmedFlag;
  }

  const trimmedEnv = env.WEACPX_COORDINATOR_SESSION?.trim();
  return trimmedEnv && trimmedEnv.length > 0 ? trimmedEnv : null;
}
