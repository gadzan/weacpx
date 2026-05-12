export const STREAMING_ELEMENT_ID = "streaming_content";
export const REASONING_ELEMENT_ID = "reasoning_content";

export type CardState = "thinking" | "streaming" | "complete" | "aborted" | "error";

// Feishu interactive card body limit is ~30k chars; leave headroom for JSON
// envelope, schema fields, and the truncation marker.
export const CARD_BODY_MAX_CHARS = 28000;
const TRUNCATION_MARKER = "\n\n…(truncated)";

export function truncateForCardBody(text: string, maxChars: number = CARD_BODY_MAX_CHARS): string {
  if (text.length <= maxChars) return text;
  // When maxChars is too small to fit the marker, drop the marker entirely
  // — the contract is "result <= maxChars". Callers that want the marker
  // are expected to pass a value > TRUNCATION_MARKER.length.
  if (maxChars <= TRUNCATION_MARKER.length) return text.slice(0, Math.max(0, maxChars));
  const room = maxChars - TRUNCATION_MARKER.length;
  return `${text.slice(0, room)}${TRUNCATION_MARKER}`;
}

export interface BuildCardInput {
  state: CardState;
  text: string;
  elapsedMs?: number;
  reasoningText?: string;
  /** Per-call override of {@link CARD_BODY_MAX_CHARS}. */
  maxBodyChars?: number;
}

export function buildCard(input: BuildCardInput): Record<string, unknown> {
  const maxChars = input.maxBodyChars ?? CARD_BODY_MAX_CHARS;
  const safeText = truncateForCardBody(input.text, maxChars);
  const isLive = input.state === "thinking" || input.state === "streaming";
  const summary = summaryForState(input.state);
  const config: Record<string, unknown> = {
    streaming_mode: isLive,
    summary,
  };

  const elements: Array<Record<string, unknown>> = [];

  const reasoning = input.reasoningText?.trim();
  if (reasoning) {
    elements.push({
      tag: "markdown",
      element_id: REASONING_ELEMENT_ID,
      content: `**🧠 思考过程**\n\n${truncateForCardBody(reasoning, maxChars)}`,
      text_align: "left",
      text_size: "notation",
    });
    elements.push({ tag: "hr" });
  }

  elements.push({
    tag: "markdown",
    element_id: STREAMING_ELEMENT_ID,
    content: input.state === "thinking" ? "" : safeText,
    text_align: "left",
    text_size: "normal_v2",
  });

  const footer = footerForState(input.state, input.elapsedMs);
  if (footer) elements.push(footer);

  return {
    schema: "2.0",
    config,
    body: { elements },
  };
}

export function formatElapsedMs(ms: number): string {
  if (!Number.isFinite(ms) || ms < 0) return "";
  if (ms < 1000) return `${ms}ms`;
  const seconds = ms / 1000;
  if (seconds < 60) return `${seconds.toFixed(1)}s`;
  const minutes = Math.floor(seconds / 60);
  const rest = Math.round(seconds - minutes * 60);
  return rest === 0 ? `${minutes}m` : `${minutes}m ${rest}s`;
}

function summaryForState(state: CardState): Record<string, unknown> {
  switch (state) {
    case "thinking":
    case "streaming":
      return { content: "Processing...", i18n_content: { zh_cn: "处理中...", en_us: "Processing..." } };
    case "complete":
      return { content: "Done", i18n_content: { zh_cn: "已完成", en_us: "Done" } };
    case "aborted":
      return { content: "Stopped", i18n_content: { zh_cn: "已停止", en_us: "Stopped" } };
    case "error":
      return { content: "Error", i18n_content: { zh_cn: "出错", en_us: "Error" } };
  }
}

function footerForState(state: CardState, elapsedMs?: number): Record<string, unknown> | null {
  const elapsedLabel = typeof elapsedMs === "number" ? formatElapsedMs(elapsedMs) : "";
  const elapsedSuffix = elapsedLabel ? ` · ${elapsedLabel}` : "";
  switch (state) {
    case "thinking":
      return {
        tag: "markdown",
        content: "_处理中..._",
        text_size: "notation",
        text_align: "left",
      };
    case "aborted":
      return {
        tag: "markdown",
        content: `🛑 _已停止_${elapsedSuffix}`,
        text_size: "notation",
        text_align: "left",
      };
    case "error":
      return {
        tag: "markdown",
        content: `❌ _出错_${elapsedSuffix}`,
        text_size: "notation",
        text_align: "left",
      };
    case "complete":
      if (!elapsedLabel) return null;
      return {
        tag: "markdown",
        content: `_已完成 · ${elapsedLabel}_`,
        text_size: "notation",
        text_align: "left",
      };
    case "streaming":
      return null;
  }
}

/**
 * Builds the `content` string for `im.message.create({ msg_type: "interactive" })`
 * that references a CardKit card instance by id.
 */
export function buildCardMessageContent(cardId: string): string {
  return JSON.stringify({ type: "card", data: { card_id: cardId } });
}
