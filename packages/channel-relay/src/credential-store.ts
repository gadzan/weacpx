import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";

import { coreHomeDir } from "xacpx/plugin-api";

export interface RelayCredential {
  instanceId: string;
  credential: string;
  relayUrl: string;
}

export function defaultCredentialPath(): string {
  return join(coreHomeDir(process.env.HOME ?? homedir()), "relay", "credential.json");
}

// Long-lived instance credential, exchanged from the one-shot pairing token on
// first connect. Lives in the xacpx state dir (weixin precedent) — NOT config.json.
export class CredentialStore {
  constructor(private readonly filePath: string) {}

  load(): RelayCredential | null {
    try {
      const parsed = JSON.parse(readFileSync(this.filePath, "utf8")) as Partial<RelayCredential>;
      if (
        typeof parsed.instanceId === "string" &&
        typeof parsed.credential === "string" &&
        typeof parsed.relayUrl === "string"
      ) {
        return { instanceId: parsed.instanceId, credential: parsed.credential, relayUrl: parsed.relayUrl };
      }
      return null;
    } catch {
      return null;
    }
  }

  save(credential: RelayCredential): void {
    mkdirSync(dirname(this.filePath), { recursive: true });
    writeFileSync(this.filePath, JSON.stringify(credential, null, 2), { encoding: "utf8", mode: 0o600 });
  }

  clear(): void {
    rmSync(this.filePath, { force: true });
  }
}
