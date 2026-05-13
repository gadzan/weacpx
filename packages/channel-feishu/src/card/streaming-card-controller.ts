import { isMessageUnavailable, markIfUnavailableError } from "../message-unavailable.js";
import { resolveFeishuReceiveIdType, normalizeFeishuTarget } from "../send.js";
import { formatErrorFootnote } from "../strings.js";
import {
  CARD_BODY_MAX_CHARS,
  STREAMING_ELEMENT_ID,
  buildCard,
  buildCardMessageContent,
  formatElapsedMs,
  truncateForCardBody,
  type CardState,
} from "./card-builder.js";
import { FlushController } from "./flush-controller.js";
import { ImageResolver, type ImageUploadClient } from "./image-resolver.js";
import { optimizeMarkdownStyle } from "./markdown-style.js";
import { splitReasoningText } from "./reasoning.js";
import { registerShutdownHook } from "./shutdown-hooks.js";
import { ToolUseStore } from "./tool-use-store.js";
import type { ToolUseEvent } from "./tool-use-types.js";

export interface StreamingCardClient {
  cardkit: {
    v1: {
      card: {
        // The SDK (pinned to ~1.60) wraps responses in `{ data: ... }`. If a
        // future minor changes this, breakage surfaces as a type error rather
        // than a silent runtime `undefined` from a tolerant `??` fallback.
        create(input: {
          data: { type: "card_json"; data: string };
        }): Promise<{ data?: { card_id?: string } }>;
        update(input: {
          path: { card_id: string };
          data: { card: { type: "card_json"; data: string }; sequence: number };
        }): Promise<unknown>;
      };
      cardElement?: {
        content(input: {
          path: { card_id: string; element_id: string };
          data: { content: string; sequence: number };
        }): Promise<unknown>;
      };
    };
  };
  im: {
    message: {
      reply(input: {
        path: { message_id: string };
        data: { msg_type: "interactive"; content: string };
      }): Promise<{ data?: { message_id?: string; chat_id?: string } }>;
      create(input: {
        params: { receive_id_type: "chat_id" | "open_id" | "user_id" };
        data: { receive_id: string; msg_type: "interactive"; content: string };
      }): Promise<{ data?: { message_id?: string; chat_id?: string } }>;
    };
    image?: {
      create(input: { data: { image_type: "message"; image: unknown } }): Promise<unknown>;
    };
  };
}

export interface StreamingCardSeedInput {
  to: string;
  replyToMessageId?: string;
}

export interface StreamingCardSeedResult {
  cardId: string;
  messageId: string;
}

export interface StreamingCardControllerOptions {
  client: StreamingCardClient;
  flushIntervalMs?: number;
  now?: () => number;
  /** Set false to skip the markdown image-URL → image_key resolver. */
  resolveImages?: boolean;
  /** Max ms to wait for in-flight image uploads at terminal states. */
  imageResolveTimeoutMs?: number;
  /** Override HTTP fetch (used by the image resolver). Defaults to global fetch. */
  fetchUrl?: (url: string, options?: { maxBytes?: number }) => Promise<Buffer>;
  /** Max bytes per uploaded image (forwarded to {@link ImageResolver}). */
  imageMaxBytes?: number;
  /** LRU cap for the image resolver's resolved/failed cache. */
  imageCacheCap?: number;
  /** Account scope for the message-unavailable cache. */
  accountId?: string;
  /**
   * Called once when card updates have failed N consecutive times (default 3).
   * Receives the latest text buffer so the channel can deliver the answer via
   * a non-card path (plain reply) without losing the user's response.
   * After firing, the controller still attempts further updates so a
   * recovering Feishu can resume the card — but the channel should treat the
   * answer as delivered out-of-band.
   */
  onCardDegraded?: (input: { buffer: string; consecutiveFailures: number }) => void;
  /** Default 3. */
  failureThreshold?: number;
  /** Max chars for the card body before truncation; default 28000. */
  cardBodyMaxChars?: number;
}

const DEFAULT_FLUSH_INTERVAL_MS = 800;
const DEFAULT_IMAGE_RESOLVE_TIMEOUT_MS = 3000;

const TERMINAL_STATES: ReadonlySet<CardState> = new Set(["complete", "aborted", "error"]);
function isTerminalState(state: CardState): boolean {
  return TERMINAL_STATES.has(state);
}

export class StreamingCardController {
  private readonly client: StreamingCardClient;
  private readonly flush: FlushController;
  private readonly now: () => number;
  private readonly imageResolver: ImageResolver | null;
  private readonly imageResolveTimeoutMs: number;
  private readonly accountId: string | undefined;
  private readonly cardBodyMaxChars: number | undefined;
  private cardId: string | null = null;
  private messageId: string | null = null;
  // Text state, split into two roles:
  //   streamedText  — accumulated from appendStream() calls during the turn.
  //                   Each call is one aggregator batch (a complete paragraph),
  //                   so calls are joined with "\n\n".
  //   appendedFinal — extra tail set by complete(finalText). Used when the
  //                   transport returns content after streaming ended (e.g. a
  //                   WeChat overflow summary + final answer that was dropped
  //                   from the live stream). Rendered below streamedText.
  // The display body is buildDisplayText().
  private streamedText = "";
  private appendedFinal = "";
  private sequence = 1;
  private state: CardState = "thinking";
  private lastPushedState: CardState | null = null;
  private lastPushedHadReasoning = false;
  private lastFooterText: string | null = null;
  private readonly toolUseStore: ToolUseStore;
  private lastPushedToolStepCount = -1;
  private terminated = false;
  private seededAtMs = 0;
  private degraded = false;
  private disposeShutdownHook: (() => void) | null = null;
  private readonly onCardDegraded: StreamingCardControllerOptions["onCardDegraded"];

  constructor(options: StreamingCardControllerOptions) {
    this.client = options.client;
    this.onCardDegraded = options.onCardDegraded;
    this.flush = new FlushController({
      minIntervalMs: options.flushIntervalMs ?? DEFAULT_FLUSH_INTERVAL_MS,
      ...(options.failureThreshold !== undefined ? { failureThreshold: options.failureThreshold } : {}),
      onFailureThreshold: (n) => {
        if (this.degraded) return;
        this.degraded = true;
        this.onCardDegraded?.({ buffer: this.buildDisplayText(), consecutiveFailures: n });
      },
    });
    this.now = options.now ?? (() => Date.now());
    this.toolUseStore = new ToolUseStore(this.now);
    this.imageResolveTimeoutMs = options.imageResolveTimeoutMs ?? DEFAULT_IMAGE_RESOLVE_TIMEOUT_MS;
    this.accountId = options.accountId;
    this.cardBodyMaxChars = options.cardBodyMaxChars;
    this.imageResolver = options.resolveImages === false
      ? null
      : new ImageResolver({
          client: this.client as ImageUploadClient,
          onImageResolved: () => {
            if (this.terminated) return;
            this.flush.requestFlush(() => this.pushUpdate());
          },
          ...(options.fetchUrl ? { fetchUrl: options.fetchUrl } : {}),
          ...(options.imageMaxBytes !== undefined ? { maxBytes: options.imageMaxBytes } : {}),
          ...(options.imageCacheCap !== undefined ? { cacheCap: options.imageCacheCap } : {}),
        });
  }

  isTerminated(): boolean {
    return this.terminated;
  }

  isDegraded(): boolean {
    return this.degraded;
  }

  async seed(input: StreamingCardSeedInput): Promise<StreamingCardSeedResult> {
    this.seededAtMs = this.now();
    const initial = buildCard({
      state: "thinking",
      text: "",
      ...(this.cardBodyMaxChars !== undefined ? { maxBodyChars: this.cardBodyMaxChars } : {}),
    });
    const createResp = await this.client.cardkit.v1.card.create({
      data: { type: "card_json", data: JSON.stringify(initial) },
    });
    const cardId = createResp.data?.card_id;
    if (!cardId) {
      throw new Error("Feishu card.create returned no card_id");
    }
    this.cardId = cardId;
    const content = buildCardMessageContent(cardId);

    const replyTo = input.replyToMessageId && !isMessageUnavailable(input.replyToMessageId, this.accountId) ? input.replyToMessageId : undefined;
    let messageId: string | undefined;
    if (replyTo) {
      try {
        const r = await this.client.im.message.reply({
          path: { message_id: replyTo },
          data: { msg_type: "interactive", content },
        });
        messageId = r.data?.message_id;
      } catch (error) {
        markIfUnavailableError(replyTo, error, this.accountId);
        // fall through to fresh send
      }
    }
    if (!messageId) {
      const target = normalizeFeishuTarget(input.to);
      const r = await this.client.im.message.create({
        params: { receive_id_type: resolveFeishuReceiveIdType(target) },
        data: { receive_id: target, msg_type: "interactive", content },
      });
      messageId = r.data?.message_id;
    }
    if (!messageId) {
      throw new Error("Feishu interactive message send returned no message_id");
    }
    this.messageId = messageId;
    this.disposeShutdownHook = registerShutdownHook(`feishu-card:${cardId}`, async () => {
      if (this.terminated) return;
      try {
        await this.abort();
      } catch {
        // swallow — process is going down
      }
    });
    return { cardId, messageId };
  }

  appendStream(chunk: string): void {
    if (!this.transitionTo("streaming") || !this.cardId) return;
    // Each appendStream call is one complete aggregator batch (a paragraph),
    // not a partial token. Insert a paragraph break between calls so markdown
    // renders them as distinct blocks instead of squashing tool-call lines and
    // agent text into one wall. Skip when prior content already ends with a
    // blank line so we don't double-space when chunks already carry trailing
    // newlines.
    if (this.streamedText.length > 0 && !this.streamedText.endsWith("\n\n")) {
      this.streamedText += this.streamedText.endsWith("\n") ? "\n" : "\n\n";
    }
    this.streamedText += chunk;
    this.flush.requestFlush(() => this.pushUpdate());
  }

  recordToolEvent(event: ToolUseEvent): void {
    if (this.terminated) return;
    this.toolUseStore.record(event);
    if (!this.cardId) return;
    // Ensure the next push goes through the full card.update path so the
    // tool-use panel actually renders (the fast-path only touches the
    // streaming_content element).
    this.flush.requestFlush(() => this.pushUpdate());
  }

  async complete(finalText?: string): Promise<void> {
    if (!this.transitionTo("complete")) return;
    // Treat finalText as a *tail* appended below the streamed content, not a
    // replacement. In streaming mode the transport normally returns "" (every
    // segment was already pushed via reply()); replacing the buffer with that
    // empty string would wipe the entire live progress, leaving the user with
    // only a "已完成" footer. The non-empty case is the overflow scenario
    // where the transport returns "summary + dropped final answer" — also a
    // tail, not a replacement.
    if (typeof finalText === "string" && finalText.length > 0) {
      this.appendedFinal = finalText;
    }
    // Drain any in-flight streaming flushes first so they get a chance to kick
    // off image uploads we need to wait for.
    await this.flush.waitIdle();
    await this.awaitImageUploads();
    // Re-drain: awaiting uploads can trigger more flushes via onImageResolved.
    await this.flush.waitIdle();
    this.terminated = true;
    await this.flush.forceFlush(() => this.pushUpdate());
  }

  async abort(message?: string): Promise<void> {
    if (!this.transitionTo("aborted")) return;
    // Same rationale as complete(): the streamed text is what the user was
    // watching — don't wipe it. The "已停止" status appears in the summary
    // and footer; the abort message is only used as a fallback display when
    // there's nothing streamed yet.
    if (typeof message === "string" && message.length > 0 && this.streamedText.length === 0) {
      this.streamedText = message;
    }
    // No image wait for abort — we want to render the stopped state promptly.
    this.terminated = true;
    await this.flush.forceFlush(() => this.pushUpdate());
  }

  async fail(errorMessage: string): Promise<void> {
    if (!this.transitionTo("error")) return;
    // Preserve whatever the agent had already streamed; append the error
    // message as a footnote so partial output isn't lost.
    const tail = errorMessage.trim();
    if (tail) {
      this.streamedText = this.streamedText.length > 0
        ? `${this.streamedText.trimEnd()}\n\n${formatErrorFootnote(tail)}`
        : tail;
    }
    this.terminated = true;
    await this.flush.forceFlush(() => this.pushUpdate());
  }

  /**
   * Compose the card body from the two-state text model. streamedText holds
   * everything pushed during the turn; appendedFinal is the optional tail from
   * complete(). When both are present we join with a blank line so the final
   * tail visually separates from the progress.
   */
  private buildDisplayText(): string {
    if (this.appendedFinal && this.streamedText) {
      return `${this.streamedText}\n\n${this.appendedFinal}`;
    }
    return this.appendedFinal || this.streamedText;
  }

  /**
   * Atomically advance the state machine. Returns false (no-op) when the
   * transition isn't legal — protects against complete/abort/fail racing each
   * other, and prevents stray appendStream calls from resurrecting a closed
   * card. Sets terminal state synchronously so concurrent callers can't both
   * pass through; the actual `terminated` flag flips after async work.
   */
  private transitionTo(next: CardState): boolean {
    if (this.state === next) {
      // Idempotent for "streaming" (each chunk re-asserts it). Terminal states
      // get rejected to keep the first complete/abort/fail authoritative.
      if (next === "streaming") return true;
      return false;
    }
    if (isTerminalState(this.state)) return false;
    if (next === "streaming" && this.state !== "thinking") return false;
    this.state = next;
    if (isTerminalState(this.state)) {
      this.disposeShutdownHook?.();
      this.disposeShutdownHook = null;
    }
    return true;
  }

  private async awaitImageUploads(): Promise<void> {
    if (!this.imageResolver || !this.imageResolver.hasPending()) return;
    await this.imageResolver.resolveImagesAwait(this.buildDisplayText(), this.imageResolveTimeoutMs);
  }

  async waitIdle(): Promise<void> {
    await this.flush.waitIdle();
  }

  private async pushUpdate(): Promise<void> {
    if (!this.cardId || !this.messageId) return;
    if (isMessageUnavailable(this.messageId, this.accountId)) return;
    const displayText = this.buildDisplayText();
    const resolvedBuffer = this.imageResolver ? this.imageResolver.resolveImages(displayText) : displayText;
    const split = splitReasoningText(resolvedBuffer);
    const answerSource = split.answerText ?? (split.reasoningText ? "" : resolvedBuffer);
    const renderedRaw = this.state === "thinking" ? answerSource : optimizeMarkdownStyle(answerSource);
    // Cap before either delivery path: buildCard re-caps to be safe, but the
    // element-content fast-path bypasses buildCard so it has to be capped
    // here too — otherwise long output sneaks past the body limit and
    // triggers CardKit "content too large" errors that count as flush
    // failures and eventually degrade the card.
    const cardBodyMax = this.cardBodyMaxChars ?? CARD_BODY_MAX_CHARS;
    const rendered = truncateForCardBody(renderedRaw, cardBodyMax);
    // Reasoning text also goes through the optimizer so stray image URLs etc.
    // don't trigger CardKit error 200570 from the reasoning element.
    const reasoningRendered = split.reasoningText
      ? optimizeMarkdownStyle(split.reasoningText).trim() || undefined
      : undefined;
    const hasReasoning = !!reasoningRendered;
    // Track whether last pushed update included a reasoning panel so element-
    // content fast-path can detect structural changes that require full update.
    const reasoningChanged = hasReasoning !== this.lastPushedHadReasoning;

    const elapsedMs = this.seededAtMs > 0 ? this.now() - this.seededAtMs : undefined;
    const currentFooterText = computeFooterText(this.state, elapsedMs);
    const footerChanged = currentFooterText !== this.lastFooterText;

    const toolSteps = this.toolUseStore.steps();
    const toolStepsChanged = toolSteps.length !== this.lastPushedToolStepCount;

    const elementApi = this.client.cardkit.v1.cardElement;
    if (
      this.state === "streaming" &&
      this.lastPushedState === "streaming" &&
      !reasoningChanged &&
      !footerChanged &&
      !toolStepsChanged &&
      elementApi
    ) {
      const seq = this.sequence++;
      try {
        await elementApi.content({
          path: { card_id: this.cardId, element_id: STREAMING_ELEMENT_ID },
          data: { content: rendered, sequence: seq },
        });
        return;
      } catch (error) {
        markIfUnavailableError(this.messageId, error, this.accountId);
        // fall through to a full card update — safer fallback for any
        // element-level failure (missing scope, element gone, etc.)
      }
    }

    const card = buildCard({
      state: this.state,
      text: rendered,
      ...(elapsedMs !== undefined ? { elapsedMs } : {}),
      ...(reasoningRendered ? { reasoningText: reasoningRendered } : {}),
      ...(toolSteps.length > 0 ? { toolSteps } : {}),
      ...(this.cardBodyMaxChars !== undefined ? { maxBodyChars: this.cardBodyMaxChars } : {}),
    });
    const seq = this.sequence++;
    try {
      await this.client.cardkit.v1.card.update({
        path: { card_id: this.cardId },
        data: { card: { type: "card_json", data: JSON.stringify(card) }, sequence: seq },
      });
      this.lastPushedState = this.state;
      this.lastPushedHadReasoning = hasReasoning;
      this.lastFooterText = currentFooterText;
      this.lastPushedToolStepCount = toolSteps.length;
    } catch (error) {
      // 230011/231003 mean the message is gone — that's a terminal "success"
      // for our purposes; don't count it as a failure (the user couldn't see
      // updates anyway). Other errors get surfaced so FlushController can
      // track the streak and potentially trigger onCardDegraded.
      const recognizedTerminal = markIfUnavailableError(this.messageId, error, this.accountId);
      if (recognizedTerminal) return;
      throw error;
    }
  }
}

function computeFooterText(state: CardState, elapsedMs: number | undefined): string {
  if (elapsedMs === undefined) return state;
  return `${state}|${formatElapsedMs(elapsedMs)}`;
}
