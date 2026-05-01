export function parseSourceHandle(
  args: string[],
  env: NodeJS.ProcessEnv = process.env,
): string | null {
  let fromFlag: string | null = null;

  for (let index = 0; index < args.length; index += 1) {
    if (args[index] === "--source-handle") {
      const value = args[index + 1];
      if (value === undefined) {
        throw new Error("--source-handle requires a non-empty value");
      }
      const trimmedValue = value.trim();
      if (trimmedValue.length === 0 || trimmedValue.startsWith("-")) {
        throw new Error("--source-handle requires a non-empty value");
      }
      fromFlag = value;
    }
  }

  const trimmedFlag = fromFlag?.trim();
  if (trimmedFlag && trimmedFlag.length > 0) {
    return trimmedFlag;
  }

  const trimmedEnv = env.WEACPX_SOURCE_HANDLE?.trim();
  return trimmedEnv && trimmedEnv.length > 0 ? trimmedEnv : null;
}
