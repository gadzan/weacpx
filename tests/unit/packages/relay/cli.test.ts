import { expect, test } from "bun:test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { runRelayCli } from "../../../../packages/relay/src/cli";

function makeIo() {
  const lines: string[] = [];
  return { lines, print: (line: string) => lines.push(line) };
}

test("init-admin creates the admin and prints generated password once", async () => {
  const dbPath = join(mkdtempSync(join(tmpdir(), "relay-cli-")), "relay.db");
  const io = makeIo();
  const code = await runRelayCli(["init-admin", "--username", "admin", "--db", dbPath], io);
  expect(code).toBe(0);
  expect(io.lines.join("\n")).toContain("admin");
  expect(io.lines.join("\n")).toMatch(/password: \S+/);
  // second run refuses (admin exists)
  const again = await runRelayCli(["init-admin", "--username", "admin", "--db", dbPath], makeIo());
  expect(again).toBe(1);
});

test("token new issues a pairing token for an existing account", async () => {
  const dbPath = join(mkdtempSync(join(tmpdir(), "relay-cli-")), "relay.db");
  await runRelayCli(["init-admin", "--username", "admin", "--db", dbPath], makeIo());
  const io = makeIo();
  const code = await runRelayCli(["token", "new", "--account", "admin", "--name", "pc", "--db", dbPath], io);
  expect(code).toBe(0);
  expect(io.lines.join("\n")).toMatch(/pairing token: \S{40,}/);
  expect(await runRelayCli(["token", "new", "--account", "ghost", "--db", dbPath], makeIo())).toBe(1);
});

test("unknown command prints usage and exits 1", async () => {
  const io = makeIo();
  expect(await runRelayCli(["bogus"], io)).toBe(1);
  expect(io.lines.join("\n")).toContain("Usage");
});
