export interface StreamingPromptState {
  buffer: string;
  segments: string[];
  hasAgentMessage: boolean;
  pendingLine: string;
  formatToolCalls: boolean;
  emittedToolCallIds: Set<string>;
  finalize: () => string;
}

interface StreamEvent {
  method?: string;
  params?: {
    update?: {
      sessionUpdate?: string;
      content?: {
        type?: string;
        text?: string;
      };
      kind?: string;
      title?: string;
      toolCallId?: string;
      rawInput?: {
        parsed_cmd?: Array<{ type: string; cmd: string; name?: string }>;
        command?: string;
      };
    };
  };
}

export function createStreamingPromptState(formatToolCalls = false): StreamingPromptState {
  return {
    buffer: "",
    segments: [],
    hasAgentMessage: false,
    pendingLine: "",
    formatToolCalls,
    emittedToolCallIds: new Set(),
    finalize(): string {
      if (this.pendingLine.trim().length > 0) {
        parseStreamingChunks(this, this.pendingLine);
      }
      const remaining = this.buffer.trim();
      this.buffer = "";
      this.pendingLine = "";
      return remaining;
    },
  };
}

export function parseStreamingDataChunk(state: StreamingPromptState, chunk: string): void {
  state.pendingLine += chunk;

  let boundary: number;
  while ((boundary = state.pendingLine.indexOf("\n")) !== -1) {
    const line = state.pendingLine.slice(0, boundary);
    state.pendingLine = state.pendingLine.slice(boundary + 1);
    parseStreamingChunks(state, line);
  }
}

export function parseStreamingChunks(state: StreamingPromptState, line: string): void {
  const trimmed = line.trim();
  if (trimmed.length === 0) return;

  let event: StreamEvent;
  try {
    event = JSON.parse(trimmed) as StreamEvent;
  } catch {
    return;
  }

  if (event.method !== "session/update") return;

  const update = event.params?.update;
  if (!update) return;

  if (state.formatToolCalls && (update.sessionUpdate === "tool_call" || update.sessionUpdate === "tool_call_update")) {
    const formatted = formatToolCallEvent(update, update.sessionUpdate);
    if (formatted) {
      const toolCallId = update.toolCallId;
      if (toolCallId) {
        if (state.emittedToolCallIds.has(toolCallId)) return;
        state.emittedToolCallIds.add(toolCallId);
      }
      state.segments.push(formatted);
    }
    return;
  }

  const isMessageChunk =
    update.sessionUpdate === "agent_message_chunk" &&
    update.content?.type === "text" &&
    typeof update.content.text === "string";

  if (!isMessageChunk) return;

  state.hasAgentMessage = true;
  const chunk = update.content!.text ?? "";
  if (chunk.length === 0) return;

  state.buffer += chunk;

  // Split on paragraph boundaries (\n\n) — there may be multiple in a single chunk
  let boundary: number;
  while ((boundary = state.buffer.indexOf("\n\n")) !== -1) {
    const segment = state.buffer.slice(0, boundary).trim();
    state.buffer = state.buffer.slice(boundary + 2);
    if (segment.length > 0) {
      state.segments.push(segment);
    }
  }
}

const KIND_EMOJI: Record<string, string> = {
  read: "\u{1F4D6}",
  search: "\u{1F50D}",
  execute: "\u{1F4BB}",
  edit: "\u{270F}\u{FE0F}",
};

function formatToolCallEvent(update: NonNullable<StreamEvent["params"]>["update"], sessionUpdate: string): string | null {
  if (!update) return null;
  const kind = update.kind ?? "";
  const title = update.title ?? "";
  if (title.length === 0) return null;

  const emoji = KIND_EMOJI[kind] ?? "\u{1F527}";

  const command = getToolDisplayCommand(update);
  if (command) {
    return `${emoji} ${truncateToolDisplay(command)}`;
  }

  if (sessionUpdate === "tool_call_update" || isGenericToolTitle(kind, title)) return null;

  return `${emoji} ${title}`;
}

function getToolDisplayCommand(update: NonNullable<StreamEvent["params"]>["update"]): string | null {
  if (!update) return null;

  const command = update.rawInput?.command;
  if (typeof command === "string" && command.length > 0) {
    return command;
  }

  const parsedCmd = update.rawInput?.parsed_cmd;
  if (parsedCmd && parsedCmd.length > 0) {
    const parts: string[] = [];
    for (const entry of parsedCmd) {
      if (entry && typeof entry.cmd === "string" && entry.cmd.length > 0) {
        parts.push(entry.cmd);
      }
    }
    if (parts.length > 0) {
      return parts.join(" ");
    }
  }

  return null;
}

function truncateToolDisplay(text: string): string {
  return text.length > 60 ? `${text.slice(0, 57)}...` : text;
}

function isGenericToolTitle(kind: string, title: string): boolean {
  const normalizedTitle = title.trim().toLowerCase();
  if (kind === "execute" && ["bash", "shell", "sh", "powershell", "cmd"].includes(normalizedTitle)) {
    return true;
  }
  if (kind === "search" && ["grep", "rg", "search"].includes(normalizedTitle)) {
    return true;
  }
  if (kind === "read" && ["read", "cat"].includes(normalizedTitle)) {
    return true;
  }
  return false;
}
