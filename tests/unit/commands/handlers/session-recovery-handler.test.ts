import { expect, test } from "bun:test";
import {
  renderSessionCreationVerificationError,
  renderTransportError,
  tryRecoverMissingSession,
} from "../../../../src/commands/handlers/session-recovery-handler";
import type { SessionRecoveryOps } from "../../../../src/commands/router-types";
import type { ResolvedSession } from "../../../../src/transport/types";

function session(overrides: Partial<ResolvedSession> = {}): ResolvedSession {
  return {
    alias: "review",
    agent: "codex",
    workspace: "backend",
    transportSession: "backend:codex",
    agentCommand: "codex",
    cwd: "/tmp/backend",
    ...overrides,
  };
}

test("renderTransportError quotes a workspace name with spaces in the attach hint", () => {
  const reply = renderTransportError(
    session({ workspace: "My Repo", cwd: "/tmp/My Repo" }),
    new Error("No acpx session found"),
  );

  expect(reply.text).toContain(
    '/session attach review --agent codex --ws "My Repo" --name <会话名>',
  );
});

test("renderTransportError leaves a clean workspace name unquoted in the attach hint", () => {
  const reply = renderTransportError(
    session({ workspace: "backend" }),
    new Error("No acpx session found"),
  );

  expect(reply.text).toContain(
    "/session attach review --agent codex --ws backend --name <会话名>",
  );
});

test("renderTransportError quotes a workspace name with spaces in the /session new hint", () => {
  const reply = renderTransportError(
    session({ workspace: "My Repo" }),
    new Error("No acpx session found"),
  );

  expect(reply.text).toContain(
    '/session new review --agent codex --ws "My Repo"',
  );
});

test("renderTransportError gives a scheduled-appropriate message for a transient session (no /session advice)", () => {
  const reply = renderTransportError(
    session({ alias: "later-k8f2", transient: true }),
    new Error("No acpx session found"),
  );

  expect(reply.text).toContain("临时会话");
  expect(reply.text).toContain("/lt");
  expect(reply.text).not.toContain("/session new");
  expect(reply.text).not.toContain("/session attach");
});

test("tryRecoverMissingSession skips persisted recovery for a transient session", async () => {
  let touchedPersistence = false;
  const ops: SessionRecoveryOps = {
    resolveSessionAgentCommand: async () => "a-different-command",
    setSessionTransportAgentCommand: async () => {
      touchedPersistence = true;
    },
    getSession: async () => null,
  };

  const result = await tryRecoverMissingSession(
    ops,
    session({ alias: "later-k8f2", transient: true }),
    new Error("No acpx session found"),
  );

  expect(result).toBeNull();
  expect(touchedPersistence).toBe(false);
});

test("renderSessionCreationVerificationError quotes a workspace name with spaces", () => {
  const reply = renderSessionCreationVerificationError(session({ workspace: "My Repo", cwd: "/tmp/My Repo" }));

  expect(reply.text).toContain(
    '/session attach review --agent codex --ws "My Repo" --name <会话名>',
  );
});

test("renderSessionCreationVerificationError leaves a clean workspace name unquoted", () => {
  const reply = renderSessionCreationVerificationError(session({ workspace: "backend" }));

  expect(reply.text).toContain(
    "/session attach review --agent codex --ws backend --name <会话名>",
  );
});
