import type { MessageDirection, MessageRecordDto } from "@ganglion/xacpx-relay-protocol";

import type { SqlDriver } from "../db.js";

interface MessageRow {
  instance_id: string;
  session_alias: string;
  direction: MessageDirection;
  text: string;
  created_at: string;
}

export class MessageStore {
  constructor(private readonly db: SqlDriver, private readonly now: () => Date = () => new Date()) {}

  append(instanceId: string, sessionAlias: string, direction: MessageDirection, text: string): void {
    this.db.run(
      "INSERT INTO messages (instance_id, session_alias, direction, text, created_at) VALUES (?,?,?,?,?)",
      [instanceId, sessionAlias, direction, text, this.now().toISOString()],
    );
  }

  /** Most recent `limit` rows for one session, oldest-first, scoped to the owning account. */
  listBySession(accountId: string, instanceId: string, sessionAlias: string, limit = 100): MessageRecordDto[] {
    const rows = this.db.all<MessageRow>(
      `SELECT m.instance_id, m.session_alias, m.direction, m.text, m.created_at
       FROM messages m JOIN instances i ON i.id = m.instance_id
       WHERE i.account_id = ? AND m.instance_id = ? AND m.session_alias = ?
       ORDER BY m.id DESC LIMIT ?`,
      [accountId, instanceId, sessionAlias, limit],
    );
    return rows.reverse().map((r) => ({
      instanceId: r.instance_id,
      sessionAlias: r.session_alias,
      direction: r.direction,
      text: r.text,
      createdAt: r.created_at,
    }));
  }

  /** Deletes messages older than maxAgeMs and/or beyond the newest maxPerSession per (instance, session). Returns rows deleted. */
  prune(opts: { maxAgeMs?: number; maxPerSession?: number }): number {
    let deleted = 0;
    if (opts.maxAgeMs !== undefined) {
      const cutoff = new Date(this.now().getTime() - opts.maxAgeMs).toISOString();
      const before = this.db.get<{ n: number }>("SELECT COUNT(*) AS n FROM messages WHERE created_at < ?", [cutoff]);
      this.db.run("DELETE FROM messages WHERE created_at < ?", [cutoff]);
      deleted += before?.n ?? 0;
    }
    if (opts.maxPerSession !== undefined) {
      const groups = this.db.all<{ instance_id: string; session_alias: string }>(
        "SELECT instance_id, session_alias FROM messages GROUP BY instance_id, session_alias HAVING COUNT(*) > ?",
        [opts.maxPerSession],
      );
      for (const g of groups) {
        const before = this.db.get<{ n: number }>(
          "SELECT COUNT(*) AS n FROM messages WHERE instance_id = ? AND session_alias = ?",
          [g.instance_id, g.session_alias],
        );
        this.db.run(
          `DELETE FROM messages WHERE instance_id = ? AND session_alias = ? AND id NOT IN (
             SELECT id FROM messages WHERE instance_id = ? AND session_alias = ? ORDER BY id DESC LIMIT ?
           )`,
          [g.instance_id, g.session_alias, g.instance_id, g.session_alias, opts.maxPerSession],
        );
        deleted += Math.max(0, (before?.n ?? 0) - opts.maxPerSession);
      }
    }
    return deleted;
  }
}
