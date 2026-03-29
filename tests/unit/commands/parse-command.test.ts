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
