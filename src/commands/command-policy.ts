import type { ChatRequestMetadata } from "../weixin/agent/interface";
import type { ParsedCommand } from "./parse-command";

export type CommandAccessDecision = { allowed: true } | { allowed: false; reason: string };

const GROUP_PUBLIC_COMMAND_KINDS = new Set<ParsedCommand["kind"]>([
  "help",
  "agents",
  "workspaces",
  "sessions",
  "session.tail",
  "session.native.list",
  "session.native.select",
  "session.native.attach",
  "status",
  "mode.show",
  "replymode.show",
  "config.show",
  "permission.status",
  "permission.auto.status",
  "groups",
  "group.get",
  "tasks",
  "task.get",
  "later.help",
  "invalid",
  "prompt",
]);

export function authorizeCommandForChat(command: ParsedCommand, metadata?: ChatRequestMetadata): CommandAccessDecision {
  if (metadata?.chatType !== "group") {
    return { allowed: true };
  }

  if (GROUP_PUBLIC_COMMAND_KINDS.has(command.kind)) {
    return { allowed: true };
  }

  if (metadata.isOwner) {
    return { allowed: true };
  }

  return {
    allowed: false,
    reason: "group-owner-required",
  };
}

const COMMAND_KIND_TO_LABEL: Record<string, string> = {
  "session.reset": "/clear",
  "session.rm": "/session rm",
  "session.tail": "/session tail",
  "replymode.set": "/replymode",
  "replymode.reset": "/replymode reset",
  "mode.set": "/mode",
  "permission.mode.set": "/permission",
  "permission.auto.set": "/permission auto",
  "config.set": "/config set",
  "agent.add": "/agent add",
  "agent.rm": "/agent rm",
  "workspace.new": "/workspace new",
  "workspace.rm": "/workspace rm",
  "delegate.request": "/delegate",
  "group.new": "/group new",
  "group.cancel": "/group cancel",
  "group.delegate": "/group",
  "tasks.clean": "/tasks clean",
  "task.approve": "/task approve",
  "task.reject": "/task reject",
  "task.cancel": "/task cancel",
  "session.use": "/use",
  "session.new": "/session new",
  "session.shortcut": "/session",
  "session.shortcut.new": "/session",
  "session.attach": "/session attach",
  "session.native.list": "/ssn",
  "session.native.select": "/ssn",
  "session.native.attach": "/ssn attach",
  "later.create": "/later",
  "later.list": "/later list",
  "later.cancel": "/later cancel",
};

export function renderCommandAccessDenied(command: ParsedCommand): string {
  return [
    `⚠️ ${renderCommandLabel(command)} 仅限群创建者/频道 owner 使用。`,
    "如果需要执行控制类操作，请由 owner 在群内发送，或改用私聊。",
  ].join("\n");
}

function renderCommandLabel(command: ParsedCommand): string {
  switch (command.kind) {
    case "prompt":
      return "该消息";
    case "invalid":
      return command.recognizedCommand;
    default:
      return COMMAND_KIND_TO_LABEL[command.kind] ?? `/${command.kind.split(".")[0]}`;
  }
}
