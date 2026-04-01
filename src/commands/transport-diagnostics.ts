export function summarizeTransportError(message: string): string {
  return message
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 200);
}

export function summarizeTransportDiagnostic(output: string): string | undefined {
  const trimmed = output.replace(/\s+/g, " ").trim();
  if (trimmed.length === 0) {
    return undefined;
  }

  return trimmed.slice(0, 200);
}

export function summarizeTransportDiagnosticTail(output: string): string | undefined {
  const trimmed = output.replace(/\s+/g, " ").trim();
  if (trimmed.length === 0) {
    return undefined;
  }

  return trimmed.slice(-200);
}

export function summarizeTransportNdjson(output: string, prefix: "stdout" | "stderr"): Record<string, string | number> {
  const lines = output
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0);

  if (lines.length === 0) {
    return {};
  }

  const methods = new Set<string>();
  let agentMessageChunkCount = 0;
  let stopReason: string | undefined;

  for (const line of lines) {
    try {
      const payload = JSON.parse(line) as {
        method?: string;
        params?: {
          update?: {
            sessionUpdate?: string;
          };
        };
        result?: {
          stopReason?: string;
        };
      };

      if (typeof payload.method === "string" && payload.method.length > 0) {
        methods.add(payload.method);
      }
      if (payload.params?.update?.sessionUpdate === "agent_message_chunk") {
        agentMessageChunkCount += 1;
      }
      if (typeof payload.result?.stopReason === "string" && payload.result.stopReason.length > 0) {
        stopReason = payload.result.stopReason;
      }
    } catch {
      continue;
    }
  }

  const summary: Record<string, string | number> = {
    [`${prefix}LineCount`]: lines.length,
  };
  if (methods.size > 0) {
    summary[`${prefix}Methods`] = [...methods].join(",");
  }
  if (agentMessageChunkCount > 0) {
    summary[`${prefix}AgentMessageChunkCount`] = agentMessageChunkCount;
  }
  if (stopReason) {
    summary[`${prefix}StopReason`] = stopReason;
  }

  return summary;
}

export function isPartialPromptOutputError(message: string): boolean {
  return message.includes("未收到最终回复");
}
