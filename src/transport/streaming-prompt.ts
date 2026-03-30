export interface StreamingPromptState {
  buffer: string;
  segments: string[];
  hasAgentMessage: boolean;
  pendingLine: string;
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
    };
  };
}

export function createStreamingPromptState(): StreamingPromptState {
  return {
    buffer: "",
    segments: [],
    hasAgentMessage: false,
    pendingLine: "",
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

  const isMessageChunk =
    event.method === "session/update" &&
    event.params?.update?.sessionUpdate === "agent_message_chunk" &&
    event.params.update.content?.type === "text" &&
    typeof event.params.update.content.text === "string";

  if (!isMessageChunk) return;

  state.hasAgentMessage = true;
  const chunk = event.params!.update!.content!.text ?? "";
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
