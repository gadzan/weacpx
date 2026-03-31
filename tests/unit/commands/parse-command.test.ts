import { expect, test } from "bun:test";

import { parseCommand } from "../../../src/commands/parse-command";

test("parses session creation flags", () => {
  expect(parseCommand("/session new api-fix --agent codex --ws backend")).toEqual({
    kind: "session.new",
    alias: "api-fix",
    agent: "codex",
    workspace: "backend",
  });
});

test("parses session creation aliases", () => {
  expect(parseCommand("/ss new api-fix -a codex --ws backend")).toEqual({
    kind: "session.new",
    alias: "api-fix",
    agent: "codex",
    workspace: "backend",
  });
});

test("parses session creation with the short workspace flag variant", () => {
  expect(parseCommand("/ss new api-fix -a codex -ws backend")).toEqual({
    kind: "session.new",
    alias: "api-fix",
    agent: "codex",
    workspace: "backend",
  });
});

test("parses the session shortcut command", () => {
  expect(parseCommand("/ss codex -d E:/projects/weacpx")).toEqual({
    kind: "session.shortcut",
    agent: "codex",
    cwd: "E:/projects/weacpx",
  });
});

test("parses the explicit session shortcut create command", () => {
  expect(parseCommand('/ss new codex -d "E:/projects/weacpx"')).toEqual({
    kind: "session.shortcut.new",
    agent: "codex",
    cwd: "E:/projects/weacpx",
  });
});

test("parses session attach flags", () => {
  expect(
    parseCommand("/session attach review --agent codex --ws backend --name existing-review"),
  ).toEqual({
    kind: "session.attach",
    alias: "review",
    agent: "codex",
    workspace: "backend",
    transportSession: "existing-review",
  });
});

test("parses session attach aliases", () => {
  expect(parseCommand("/ss attach review -a codex --ws backend --name existing-review")).toEqual({
    kind: "session.attach",
    alias: "review",
    agent: "codex",
    workspace: "backend",
    transportSession: "existing-review",
  });
});

test("parses session attach with the short workspace flag variant", () => {
  expect(parseCommand("/ss attach review -a codex -ws backend --name existing-review")).toEqual({
    kind: "session.attach",
    alias: "review",
    agent: "codex",
    workspace: "backend",
    transportSession: "existing-review",
  });
});

test("parses use command", () => {
  expect(parseCommand("/use api-fix")).toEqual({
    kind: "session.use",
    alias: "api-fix",
  });
});

test("parses workspace creation flags", () => {
  expect(parseCommand("/workspace new backend --cwd /tmp/backend")).toEqual({
    kind: "workspace.new",
    name: "backend",
    cwd: "/tmp/backend",
  });
});

test("parses workspace creation aliases", () => {
  expect(parseCommand("/ws new backend -d /tmp/backend")).toEqual({
    kind: "workspace.new",
    name: "backend",
    cwd: "/tmp/backend",
  });
});

test("parses quoted workspace paths with spaces", () => {
  expect(parseCommand('/ws new backend -d "E:\\My Projects\\weacpx repo"')).toEqual({
    kind: "workspace.new",
    name: "backend",
    cwd: "E:\\My Projects\\weacpx repo",
  });
});

test("parses workspace removal", () => {
  expect(parseCommand("/workspace rm backend")).toEqual({
    kind: "workspace.rm",
    name: "backend",
  });
});

test("treats bare session commands as the sessions list", () => {
  expect(parseCommand("/session")).toEqual({
    kind: "sessions",
  });
  expect(parseCommand("/ss")).toEqual({
    kind: "sessions",
  });
});

test("treats bare workspace commands as the workspaces list", () => {
  expect(parseCommand("/workspace")).toEqual({
    kind: "workspaces",
  });
  expect(parseCommand("/ws")).toEqual({
    kind: "workspaces",
  });
});

test("parses stop as cancel", () => {
  expect(parseCommand("/stop")).toEqual({
    kind: "cancel",
  });
});

test("parses session reset and clear aliases", () => {
  expect(parseCommand("/session reset")).toEqual({
    kind: "session.reset",
  });
  expect(parseCommand("/clear")).toEqual({
    kind: "session.reset",
  });
});

test("parses agent template registration", () => {
  expect(parseCommand("/agent add claude")).toEqual({
    kind: "agent.add",
    template: "claude",
  });
});

test("parses agent removal", () => {
  expect(parseCommand("/agent rm claude")).toEqual({
    kind: "agent.rm",
    name: "claude",
  });
});

test("parses permission status commands", () => {
  expect(parseCommand("/pm")).toEqual({
    kind: "permission.status",
  });
  expect(parseCommand("/permission")).toEqual({
    kind: "permission.status",
  });
});

test("parses mode show and set commands", () => {
  expect(parseCommand("/mode")).toEqual({
    kind: "mode.show",
  });
  expect(parseCommand("/mode plan")).toEqual({
    kind: "mode.set",
    modeId: "plan",
  });
});

test("parses permission mode update commands", () => {
  expect(parseCommand("/pm set allow")).toEqual({
    kind: "permission.mode.set",
    mode: "approve-all",
  });
  expect(parseCommand("/pm set read")).toEqual({
    kind: "permission.mode.set",
    mode: "approve-reads",
  });
  expect(parseCommand("/pm set deny")).toEqual({
    kind: "permission.mode.set",
    mode: "deny-all",
  });
});

test("parses permission auto commands", () => {
  expect(parseCommand("/pm auto")).toEqual({
    kind: "permission.auto.status",
  });
  expect(parseCommand("/pm auto allow")).toEqual({
    kind: "permission.auto.set",
    policy: "allow",
  });
  expect(parseCommand("/pm auto deny")).toEqual({
    kind: "permission.auto.set",
    policy: "deny",
  });
  expect(parseCommand("/pm auto fail")).toEqual({
    kind: "permission.auto.set",
    policy: "fail",
  });
});

test("treats plain text as a prompt", () => {
  expect(parseCommand("fix the timeout issue")).toEqual({
    kind: "prompt",
    text: "fix the timeout issue",
  });
});

test("returns invalid for /ss new with unsupported flag", () => {
  expect(parseCommand("/ss new claude -ws weacpx")).toEqual({
    kind: "invalid",
    text: "/ss new claude -ws weacpx",
    recognizedCommand: "/session",
  });
});

test("returns invalid for /session new missing --agent flag", () => {
  expect(parseCommand("/session new claude --ws weacpx")).toEqual({
    kind: "invalid",
    text: "/session new claude --ws weacpx",
    recognizedCommand: "/session",
  });
});

test("returns prompt for unrecognized command prefix", () => {
  expect(parseCommand("/unknown_cmd foo bar")).toEqual({
    kind: "prompt",
    text: "/unknown_cmd foo bar",
  });
});

test("returns invalid for /session new with wrong flag", () => {
  expect(parseCommand("/session new demo --xyz value")).toEqual({
    kind: "invalid",
    text: "/session new demo --xyz value",
    recognizedCommand: "/session",
  });
});

test("returns invalid for malformed permission commands", () => {
  expect(parseCommand("/permission set foo")).toEqual({
    kind: "invalid",
    text: "/permission set foo",
    recognizedCommand: "/permission",
  });
  expect(parseCommand("/permission auto maybe")).toEqual({
    kind: "invalid",
    text: "/permission auto maybe",
    recognizedCommand: "/permission",
  });
});
