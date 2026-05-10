import { mkdir, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";

export function resolvePluginHome(input: { home?: string; pluginHome?: string } = {}): string {
  if (input.pluginHome?.trim()) return input.pluginHome;
  if (process.env.WEACPX_PLUGIN_HOME?.trim()) return process.env.WEACPX_PLUGIN_HOME;
  const home = input.home ?? process.env.HOME ?? homedir();
  return join(home, ".weacpx", "plugins");
}

export async function ensurePluginHome(pluginHome: string): Promise<void> {
  await mkdir(pluginHome, { recursive: true, mode: 0o700 });
  await writeFile(
    join(pluginHome, "package.json"),
    JSON.stringify({ private: true, type: "module" }, null, 2) + "\n",
    { flag: "wx" },
  ).catch((error: NodeJS.ErrnoException) => {
    if (error.code !== "EEXIST") throw error;
  });
}
