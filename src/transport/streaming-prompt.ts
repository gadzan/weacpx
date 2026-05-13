import type { ToolUseEvent, ToolUseKind, ToolUseStatus } from "../channels/types.js";

export interface StreamingPromptState {
  buffer: string;
  segments: string[];
  hasAgentMessage: boolean;
  pendingLine: string;
  formatToolCalls: boolean;
  emittedToolCallIds: Set<string>;
  onToolEvent?: (event: ToolUseEvent) => void | Promise<void>;
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
      rawInput?: unknown;
    };
  };
}

export function createStreamingPromptState(
  formatToolCalls = false,
  onToolEvent?: (event: ToolUseEvent) => void | Promise<void>,
): StreamingPromptState {
  return {
    buffer: "",
    segments: [],
    hasAgentMessage: false,
    pendingLine: "",
    formatToolCalls,
    emittedToolCallIds: new Set(),
    onToolEvent,
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
    if (state.onToolEvent) {
      const event = buildToolUseEvent(update);
      if (event) void state.onToolEvent(event);
      return;
    }
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
  think: "\u{1F9E0}",
};

function formatToolCallEvent(update: NonNullable<StreamEvent["params"]>["update"], sessionUpdate: string): string | null {
  if (!update) return null;
  const kind = update.kind ?? "";
  const title = update.title ?? "";
  if (title.length === 0) return null;

  const emoji = KIND_EMOJI[kind] ?? "\u{1F527}";
  const inputSummary = summarizeToolInput(update.rawInput, title);
  const status = readString(update, "status");

  // Some agents first emit a placeholder pending tool_call (for example
  // "Read File" with empty rawInput), then follow up with tool_call_update
  // carrying the useful file path/command. Do not mark the toolCallId as
  // emitted until we have something actionable to show.
  if (!inputSummary && status === "pending") return null;
  if (!inputSummary && isGenericToolTitle(kind, title)) return null;

  const summaryText = inputSummary && inputSummary !== title ? `: ${truncateToolDisplay(inputSummary)}` : "";
  const statusText = status ? ` (${status})` : "";
  return `${emoji} ${title}${statusText}${summaryText}`;
}

function buildToolUseEvent(update: NonNullable<StreamEvent["params"]>["update"]): ToolUseEvent | null {
  if (!update) return null;
  const toolCallId = update.toolCallId;
  if (!toolCallId) return null;
  const kindRaw = update.kind ?? "";
  const kind: ToolUseKind = ((): ToolUseKind => {
    switch (kindRaw) {
      case "read": case "search": case "execute": case "edit": case "think": return kindRaw;
      default: return "other";
    }
  })();
  const title = (update.title ?? "").trim();
  const toolName = title || "Tool";
  // Reuse the existing summarizer (it has the title-vs-summary dedup logic baked in).
  const summaryRaw = summarizeToolInput(update.rawInput, title);
  const summary = summaryRaw && summaryRaw !== title ? summaryRaw : undefined;
  const statusRaw = readString(update, "status");
  const status: ToolUseStatus =
    statusRaw === "completed" || statusRaw === "success" ? "success"
    : statusRaw === "failed" || statusRaw === "error" ? "error"
    : "running";
  return {
    toolCallId,
    toolName,
    kind,
    ...(summary ? { summary } : {}),
    status,
  };
}

function summarizeToolInput(rawInput: unknown, title = ""): string | undefined {
  if (rawInput == null) return undefined;
  if (typeof rawInput === "string" || typeof rawInput === "number" || typeof rawInput === "boolean") {
    return String(rawInput);
  }
  if (!isRecord(rawInput)) return undefined;

  const taskSummary = summarizeTaskInput(rawInput, title);
  if (taskSummary) return taskSummary;

  const command = readFirstString(rawInput, ["command", "cmd", "program"]);
  const args = readFirstStringArray(rawInput, ["args", "arguments"]);
  if (command) {
    return [command, ...(args ?? [])].join(" ");
  }

  const parsedCmd = rawInput.parsed_cmd;
  if (Array.isArray(parsedCmd) && parsedCmd.length > 0) {
    const parts: string[] = [];
    for (const entry of parsedCmd) {
      if (isRecord(entry) && typeof entry.cmd === "string" && entry.cmd.length > 0) {
        parts.push(entry.cmd);
      }
    }
    if (parts.length > 0) {
      return parts.join(" ");
    }
  }

  return readFirstString(rawInput, [
    "path",
    "file",
    "filePath",
    "filepath",
    "file_path",
    "target",
    "uri",
    "url",
    "query",
    "pattern",
    "text",
    "search",
    "name",
    "description",
  ]);
}

function summarizeTaskInput(rawInput: Record<string, unknown>, title: string): string | undefined {
  const subagentType = readFirstString(rawInput, ["subagent_type", "subagentType", "agent", "agentType"]);
  const description = readFirstString(rawInput, ["description", "task", "summary"]);
  if (subagentType && description) {
    return description === title ? subagentType : `${subagentType}: ${description}`;
  }
  if (subagentType) return subagentType;
  return undefined;
}

function readFirstString(record: Record<string, unknown>, keys: readonly string[]): string | undefined {
  for (const key of keys) {
    const value = record[key];
    if (typeof value === "string" && value.trim().length > 0) {
      return value.trim();
    }
  }
  return undefined;
}

function readFirstStringArray(record: Record<string, unknown>, keys: readonly string[]): string[] | undefined {
  for (const key of keys) {
    const value = record[key];
    if (!Array.isArray(value)) continue;
    const entries = value
      .map((entry) => (typeof entry === "string" && entry.trim().length > 0 ? entry.trim() : undefined))
      .filter((entry): entry is string => entry !== undefined);
    if (entries.length > 0) {
      return entries;
    }
  }
  return undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readString(rawInput: unknown, key: string): string | undefined {
  if (!isRecord(rawInput)) return undefined;
  const value = rawInput[key];
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : undefined;
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
