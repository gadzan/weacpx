export interface PromptCommandResult {
  code: number;
  stdout: string;
  stderr: string;
}

interface ExtractedPromptOutput {
  text: string;
  hasAgentMessage: boolean;
}

export function getPromptText(result: PromptCommandResult): string {
  const stdoutOutput = extractPromptOutput(result.stdout);
  if (result.code === 0) {
    return sanitizePromptText(stdoutOutput.text);
  }

  const preferredError = extractPromptFailureMessage(result);
  if (preferredError) {
    throw new Error(preferredError);
  }

  const stderrOutput = extractPromptOutput(result.stderr);
  const partialReply = [stdoutOutput, stderrOutput]
    .filter((output) => output.hasAgentMessage && output.text.length > 0)
    .map((output) => sanitizePromptText(output.text))
    .find((text) => text.length > 0);

  if (partialReply) {
    return partialReply;
  }

  throw new Error(`command failed with exit code ${result.code}`);
}

export function normalizeCommandError(result: Pick<PromptCommandResult, "stdout" | "stderr">): string | null {
  const preferredError = extractPromptFailureMessage(result);
  if (preferredError) {
    return preferredError;
  }

  return result.stdout.trim() || null;
}

function extractPromptFailureMessage(result: Pick<PromptCommandResult, "stdout" | "stderr">): string | null {
  const rpcMessages = extractJsonRpcErrorMessages(result.stderr)
    .concat(extractJsonRpcErrorMessages(result.stdout))
    .filter((message) => message.length > 0);

  const preferredMessage = [...rpcMessages].reverse().find((message) => message !== "Resource not found");
  if (preferredMessage) {
    return preferredMessage;
  }

  if (rpcMessages.length > 0) {
    return rpcMessages[rpcMessages.length - 1] ?? null;
  }

  const stderrText = result.stderr.trim();
  if (stderrText.length > 0) {
    return stderrText;
  }

  return null;
}

function extractPromptOutput(output: string): ExtractedPromptOutput {
  const lines = output
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0);

  const messageSegments: string[] = [];
  let currentSegment = "";
  let hasAgentMessage = false;

  for (const line of lines) {
    try {
      const event = JSON.parse(line) as {
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
      };

      const isMessageChunk =
        event.method === "session/update" &&
        event.params?.update?.sessionUpdate === "agent_message_chunk" &&
        event.params.update.content?.type === "text" &&
        typeof event.params.update.content.text === "string";

      if (isMessageChunk) {
        hasAgentMessage = true;
        const chunk = event.params!.update!.content!.text ?? "";
        if (chunk.length > 0) {
          currentSegment += chunk;
        }
        continue;
      }

      if (currentSegment.trim().length > 0) {
        messageSegments.push(currentSegment.trim());
      }
      currentSegment = "";
    } catch {
      if (currentSegment.trim().length > 0) {
        messageSegments.push(currentSegment.trim());
        currentSegment = "";
      }
    }
  }

  if (currentSegment.trim().length > 0) {
    messageSegments.push(currentSegment.trim());
  }

  if (messageSegments.length > 0) {
    return {
      text: messageSegments[messageSegments.length - 1]!,
      hasAgentMessage,
    };
  }

  return {
    text: output.trim(),
    hasAgentMessage,
  };
}

function sanitizePromptText(text: string): string {
  const trimmed = text.trim();
  const paragraphs = trimmed.split(/\n\s*\n/);
  if (paragraphs.length < 2) {
    return trimmed;
  }

  const firstParagraph = paragraphs[0]!.trim().replace(/\s+/g, " ").toLowerCase();
  if (!looksLikeWorkflowPreamble(firstParagraph)) {
    return trimmed;
  }

  return paragraphs.slice(1).join("\n\n").trim();
}

function looksLikeWorkflowPreamble(paragraph: string): boolean {
  if (!paragraph.startsWith("using ")) {
    return false;
  }

  return (
    paragraph.includes("using-superpowers") ||
    paragraph.includes("repo workflow requirement") ||
    paragraph.includes("workflow requirement") ||
    paragraph.includes("before responding") ||
    paragraph.includes("skill check")
  );
}

function extractJsonRpcErrorMessages(output: string): string[] {
  return output
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .flatMap((line) => {
      try {
        const payload = JSON.parse(line) as {
          error?: {
            message?: string;
          };
        };

        if (typeof payload.error?.message === "string" && payload.error.message.length > 0) {
          return [payload.error.message];
        }
      } catch {
        return [];
      }

      return [];
    });
}
