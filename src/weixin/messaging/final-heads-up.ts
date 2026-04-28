// v1.4: when a paginated final answer can't fit in the remaining final-tier
// budget, the last chunk of each "wave" carries a heads-up tail telling the
// user how many segments they've received and how to ask for the next wave
// (`/jx` resets the inbound window and drains the next wave from the pending
// queue stored in QuotaManager).
//
// This is intentionally separate from the mid-tier heads-up
// (DEFAULT_HEADS_UP_TEXT in quota-gated-reply-sink.ts) so the two paths can
// evolve independently — the mid heads-up describes "task still running",
// while the final heads-up describes "more pages waiting".

export interface FinalHeadsUpInput {
  total: number;
  sentSoFar: number;
}

export function buildFinalHeadsUp(input: FinalHeadsUpInput): string {
  const { total, sentSoFar } = input;
  const remaining = Math.max(total - sentSoFar, 0);
  return `—\n📄 结果共 ${total} 段，已发 ${sentSoFar} 段。回复 /jx 续看后 ${remaining} 段。`;
}
