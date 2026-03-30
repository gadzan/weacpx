export type ParsedCommand =
  | { kind: "help" }
  | { kind: "agents" }
  | { kind: "agent.add"; template: string }
  | { kind: "agent.rm"; name: string }
  | { kind: "permission.status" }
  | { kind: "permission.mode.set"; mode: "approve-all" | "approve-reads" | "deny-all" }
  | { kind: "permission.auto.status" }
  | { kind: "permission.auto.set"; policy: "allow" | "deny" | "fail" }
  | { kind: "workspaces" }
  | { kind: "workspace.new"; name: string; cwd: string }
  | { kind: "workspace.rm"; name: string }
  | { kind: "sessions" }
  | { kind: "status" }
  | { kind: "cancel" }
  | { kind: "session.reset" }
  | { kind: "session.use"; alias: string }
  | { kind: "session.new"; alias: string; agent: string; workspace: string }
  | { kind: "session.shortcut"; agent: string; cwd: string }
  | { kind: "session.shortcut.new"; agent: string; cwd: string }
  | { kind: "session.attach"; alias: string; agent: string; workspace: string; transportSession: string }
  | { kind: "invalid"; text: string; recognizedCommand: string }
  | { kind: "prompt"; text: string };

export function parseCommand(input: string): ParsedCommand {
  const trimmed = input.trim();
  if (!trimmed.startsWith("/")) {
    return { kind: "prompt", text: trimmed };
  }

  const parts = tokenizeCommand(trimmed);
  const command = normalizeCommand(parts[0] ?? "");

  if (command === "/help") return { kind: "help" };
  if (command === "/agents") return { kind: "agents" };
  if (command === "/workspaces") return { kind: "workspaces" };
  if (command === "/sessions") return { kind: "sessions" };
  if (command === "/status") return { kind: "status" };
  if (command === "/cancel") return { kind: "cancel" };
  if (command === "/clear") return { kind: "session.reset" };
  if (command === "/permission" && parts.length === 1) return { kind: "permission.status" };
  if (command === "/session" && parts.length === 1) return { kind: "sessions" };
  if (command === "/workspace" && parts.length === 1) return { kind: "workspaces" };
  if (command === "/session" && parts[1] === "reset" && parts.length === 2) return { kind: "session.reset" };

  if (command === "/permission" && parts[1] === "set") {
    const mode = toPermissionMode(parts[2] ?? "");
    if (mode) {
      return { kind: "permission.mode.set", mode };
    }
  }

  if (command === "/permission" && parts[1] === "auto") {
    if (parts.length === 2) {
      return { kind: "permission.auto.status" };
    }

    const policy = toNonInteractivePermission(parts[2] ?? "");
    if (policy) {
      return { kind: "permission.auto.set", policy };
    }
  }

  if (command === "/use" && parts[1]) {
    return { kind: "session.use", alias: parts[1] };
  }

  if (command === "/agent" && parts[1] === "add" && parts[2]) {
    return { kind: "agent.add", template: parts[2] };
  }

  if (command === "/agent" && parts[1] === "rm" && parts[2]) {
    return { kind: "agent.rm", name: parts[2] };
  }

  if (command === "/workspace" && parts[1] === "new" && parts[2]) {
    const name = parts[2];
    let cwd = "";

    for (let index = 3; index < parts.length; index += 1) {
      if (parts[index] === "--cwd" || parts[index] === "-d") {
        cwd = parts[index + 1] ?? "";
        index += 1;
      }
    }

    return { kind: "workspace.new", name, cwd };
  }

  if (command === "/workspace" && parts[1] === "rm" && parts[2]) {
    return { kind: "workspace.rm", name: parts[2] };
  }

  if (command === "/session" && parts[1] === "new" && parts[2]) {
    if (hasAnyFlag(parts, ["--agent", "-a"])) {
      const alias = parts[2];
      let agent = "";
      let workspace = "";

      for (let index = 3; index < parts.length; index += 1) {
        if (parts[index] === "--agent" || parts[index] === "-a") {
          agent = parts[index + 1] ?? "";
          index += 1;
        } else if (parts[index] === "--ws" || parts[index] === "-ws") {
          workspace = parts[index + 1] ?? "";
          index += 1;
        }
      }

      return { kind: "session.new", alias, agent, workspace };
    }

    const cwd = readFlagValue(parts, ["--cwd", "-d"]);
    if (cwd) {
      return { kind: "session.shortcut.new", agent: parts[2], cwd };
    }
  }

  if (command === "/session" && parts[1] && parts[1] !== "new" && parts[1] !== "attach" && parts[1] !== "reset") {
    const cwd = readFlagValue(parts, ["--cwd", "-d"]);
    if (cwd) {
      return { kind: "session.shortcut", agent: parts[1], cwd };
    }
  }

  if (command === "/session" && parts[1] === "attach" && parts[2]) {
    const alias = parts[2];
    let agent = "";
    let workspace = "";
    let transportSession = "";

    for (let index = 3; index < parts.length; index += 1) {
      if (parts[index] === "--agent" || parts[index] === "-a") {
        agent = parts[index + 1] ?? "";
        index += 1;
      } else if (parts[index] === "--ws" || parts[index] === "-ws") {
        workspace = parts[index + 1] ?? "";
        index += 1;
      } else if (parts[index] === "--name") {
        transportSession = parts[index + 1] ?? "";
        index += 1;
      }
    }

    return { kind: "session.attach", alias, agent, workspace, transportSession };
  }

  // 如果命令前缀被识别但参数不匹配任何子命令，返回 invalid
if (command.startsWith("/") && isRecognizedCommand(command)) {
  return { kind: "invalid", text: trimmed, recognizedCommand: command };
}

return { kind: "prompt", text: trimmed };
}

function hasAnyFlag(parts: string[], flags: string[]): boolean {
  return parts.some((part) => flags.includes(part));
}

function readFlagValue(parts: string[], flags: string[]): string {
  for (let index = 0; index < parts.length; index += 1) {
    if (flags.includes(parts[index] ?? "")) {
      return parts[index + 1] ?? "";
    }
  }

  return "";
}

function normalizeCommand(command: string): string {
  if (command === "/ss") return "/session";
  if (command === "/ws") return "/workspace";
  if (command === "/pm") return "/permission";
  if (command === "/stop") return "/cancel";
  return command;
}

const RECOGNIZED_COMMANDS = new Set([
  "/help",
  "/agents",
  "/workspaces",
  "/sessions",
  "/status",
  "/cancel",
  "/clear",
  "/permission",
  "/session",
  "/workspace",
  "/use",
  "/agent",
]);

function isRecognizedCommand(command: string): boolean {
  return RECOGNIZED_COMMANDS.has(command);
}

function toPermissionMode(value: string): "approve-all" | "approve-reads" | "deny-all" | null {
  if (value === "allow") return "approve-all";
  if (value === "read") return "approve-reads";
  if (value === "deny") return "deny-all";
  return null;
}

function toNonInteractivePermission(value: string): "allow" | "deny" | "fail" | null {
  if (value === "allow" || value === "deny" || value === "fail") {
    return value;
  }

  return null;
}

function tokenizeCommand(input: string): string[] {
  const tokens: string[] = [];
  let current = "";
  let quote: '"' | "'" | null = null;

  for (const char of input) {
    if (quote) {
      if (char === quote) {
        quote = null;
      } else {
        current += char;
      }
      continue;
    }

    if (char === '"' || char === "'") {
      quote = char;
      continue;
    }

    if (/\s/.test(char)) {
      if (current.length > 0) {
        tokens.push(current);
        current = "";
      }
      continue;
    }

    current += char;
  }

  if (current.length > 0) {
    tokens.push(current);
  }

  return tokens;
}
