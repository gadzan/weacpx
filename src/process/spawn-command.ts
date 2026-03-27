const SCRIPT_FILE_PATTERN = /\.(c|m)?js$/i;

export interface SpawnCommandSpec {
  command: string;
  args: string[];
}

export function resolveSpawnCommand(command: string, args: string[]): SpawnCommandSpec {
  if (SCRIPT_FILE_PATTERN.test(command)) {
    return {
      command: process.execPath,
      args: [command, ...args],
    };
  }

  return { command, args };
}
