import type {
  EnsureSessionProgress,
  EnsureSessionProgressStage,
  PermissionPolicy,
  PromptOptions,
  ReplyQuotaContext,
  ResolvedSession,
  SessionTransport,
} from "../types";
import { buildOverflowSummary, createQuotaGatedReplySink } from "../quota-gated-reply-sink";
import type { BridgeMethod } from "./acpx-bridge-protocol";
import type { BridgeEvent } from "./acpx-bridge-client";

interface BridgeRequestClient {
  request<TResult>(
    method: BridgeMethod,
    params: Record<string, unknown>,
    onEvent?: (event: BridgeEvent) => void,
  ): Promise<TResult>;
}

export class AcpxBridgeTransport implements SessionTransport {
  constructor(private readonly client: BridgeRequestClient & { dispose?: () => Promise<void> }) {}

  async ensureSession(session: ResolvedSession, onProgress?: (progress: EnsureSessionProgress) => void): Promise<void> {
    await this.client.request("ensureSession", this.toParams(session), onProgress
      ? (event) => {
          if (event.type === "session.progress" && event.stage) {
            onProgress(event.stage as EnsureSessionProgressStage);
          } else if (event.type === "session.note") {
            onProgress({ kind: "note", text: event.text });
          }
        }
      : undefined);
  }

  async prompt(
    session: ResolvedSession,
    text: string,
    reply?: (text: string) => Promise<void>,
    replyContext?: ReplyQuotaContext,
    options?: PromptOptions,
  ): Promise<{ text: string }> {
    const sink = reply
      ? createQuotaGatedReplySink({
          reply,
          ...(replyContext ? { replyContext } : {}),
        })
      : null;
    let segmentError: unknown;
    let segmentChain = Promise.resolve();
    const result = await this.client.request<{ text: string }>("prompt", {
      ...this.toParams(session),
      text,
      ...(options?.media ? { media: options.media } : {}),
    }, (event) => {
      if (event.type === "prompt.segment") {
        const onSegment = options?.onSegment;
        if (onSegment) {
          const segmentText = event.text;
          segmentChain = segmentChain
            .then(() => onSegment(segmentText))
            .catch((error) => {
              segmentError ??= error;
            });
        }
        sink?.feedSegment(event.text);
      }
    });
    await segmentChain;
    if (sink) {
      const { overflowCount } = sink.finalize();
      // Drain in-flight reply() promises and propagate any QuotaDeferredError
      // captured by the sink so callers (e.g. wakeCoordinator) can detect that
      // the outbound pushReply was deferred mid-stream and preserve
      // injectionPending instead of marking the wake as completed.
      await sink.drain({ timeoutMs: 30_000 });
      const deferred = sink.getPendingError();
      if (deferred) {
        throw deferred;
      }
      const summary = buildOverflowSummary(overflowCount);
      // Streaming mode already pushed every segment through reply() (mid quota).
      // Returning result.text again would duplicate what the user just saw. Only
      // surface a final-tier text when overflow happened — in that case the
      // summary is new info AND result.text carries the agent's final answer
      // that may have been partially or fully dropped from the stream.
      if (segmentError) {
        throw segmentError;
      }
      return { text: summary ? `${summary}\n\n${result.text}` : "" };
    }
    if (segmentError) {
      throw segmentError;
    }
    return result;
  }

  async setMode(session: ResolvedSession, modeId: string): Promise<void> {
    await this.client.request("setMode", {
      ...this.toParams(session),
      modeId,
    });
  }

  async cancel(session: ResolvedSession): Promise<{ cancelled: boolean; message: string }> {
    return await this.client.request("cancel", this.toParams(session));
  }

  async removeSession(session: ResolvedSession): Promise<void> {
    await this.client.request("removeSession", this.toParams(session));
  }

  async hasSession(session: ResolvedSession): Promise<boolean> {
    const result = await this.client.request<{ exists: boolean }>("hasSession", this.toParams(session));
    return result.exists;
  }


  async updatePermissionPolicy(policy: PermissionPolicy): Promise<void> {
    await this.client.request("updatePermissionPolicy", { ...policy });
  }
  async dispose(): Promise<void> {
    await this.client.dispose?.();
  }

  private toParams(session: ResolvedSession): Record<string, unknown> {
    return {
      agent: session.agent,
      agentCommand: session.agentCommand,
      cwd: session.cwd,
      name: session.transportSession,
      mcpCoordinatorSession: session.mcpCoordinatorSession,
      mcpSourceHandle: session.mcpSourceHandle,
      ...(session.replyMode ? { replyMode: session.replyMode } : {}),
    };
  }
}
