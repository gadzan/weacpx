export function parseInternalSessionToolsFlag(
  args: string[],
  _env: NodeJS.ProcessEnv = process.env,
): boolean {
  return args.includes("--internal-session-tools");
}
