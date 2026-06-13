import { randomUUID } from "node:crypto";

import { generateToken, hashPassword, hashToken, verifyPassword } from "../auth.js";
import type { SqlDriver } from "../db.js";

export type AccountRole = "admin" | "member";

export interface AccountRow {
  id: string;
  username: string;
  role: AccountRole;
  createdAt: string;
}

interface AccountStoreOptions {
  now?: () => Date;
}

export class AccountStore {
  private readonly now: () => Date;

  constructor(private readonly db: SqlDriver, options: AccountStoreOptions = {}) {
    this.now = options.now ?? (() => new Date());
  }

  createAccount(username: string, password: string, role: AccountRole): AccountRow {
    const id = randomUUID();
    const createdAt = this.now().toISOString();
    this.db.run(
      "INSERT INTO accounts (id, username, password_hash, role, created_at) VALUES (?, ?, ?, ?, ?)",
      [id, username, hashPassword(password), role, createdAt],
    );
    return { id, username, role, createdAt };
  }

  findByUsername(username: string): AccountRow | null {
    const row = this.db.get<{ id: string; username: string; role: AccountRole; created_at: string }>(
      "SELECT id, username, role, created_at FROM accounts WHERE username = ?",
      [username],
    );
    return row ? { id: row.id, username: row.username, role: row.role, createdAt: row.created_at } : null;
  }

  findById(id: string): AccountRow | null {
    const row = this.db.get<{ id: string; username: string; role: AccountRole; created_at: string }>(
      "SELECT id, username, role, created_at FROM accounts WHERE id = ?",
      [id],
    );
    return row ? { id: row.id, username: row.username, role: row.role, createdAt: row.created_at } : null;
  }

  verifyLogin(username: string, password: string): AccountRow | null {
    const row = this.db.get<{ id: string; username: string; password_hash: string; role: AccountRole; created_at: string }>(
      "SELECT id, username, password_hash, role, created_at FROM accounts WHERE username = ?",
      [username],
    );
    if (!row || !verifyPassword(password, row.password_hash)) return null;
    return { id: row.id, username: row.username, role: row.role, createdAt: row.created_at };
  }

  createInvite(createdByAccountId: string, ttlMs: number): { token: string; expiresAt: string } {
    const token = generateToken();
    const expiresAt = new Date(this.now().getTime() + ttlMs).toISOString();
    this.db.run(
      "INSERT INTO invites (token_hash, created_by, expires_at) VALUES (?, ?, ?)",
      [hashToken(token), createdByAccountId, expiresAt],
    );
    return { token, expiresAt };
  }

  validateInvite(token: string): boolean {
    const row = this.db.get<{ expires_at: string; used_by: string | null }>(
      "SELECT expires_at, used_by FROM invites WHERE token_hash = ?",
      [hashToken(token)],
    );
    if (!row || row.used_by !== null) return false;
    return new Date(row.expires_at).getTime() > this.now().getTime();
  }

  markInviteUsed(token: string, usedByAccountId: string): void {
    this.db.run("UPDATE invites SET used_by = ? WHERE token_hash = ?", [usedByAccountId, hashToken(token)]);
  }

  createWebSession(accountId: string, ttlMs: number): string {
    const token = generateToken();
    const expiresAt = new Date(this.now().getTime() + ttlMs).toISOString();
    this.db.run(
      "INSERT INTO web_sessions (token_hash, account_id, expires_at) VALUES (?, ?, ?)",
      [hashToken(token), accountId, expiresAt],
    );
    return token;
  }

  getSessionAccount(token: string): AccountRow | null {
    const row = this.db.get<{ account_id: string; expires_at: string }>(
      "SELECT account_id, expires_at FROM web_sessions WHERE token_hash = ?",
      [hashToken(token)],
    );
    if (!row || new Date(row.expires_at).getTime() <= this.now().getTime()) return null;
    return this.findById(row.account_id);
  }

  deleteWebSession(token: string): void {
    this.db.run("DELETE FROM web_sessions WHERE token_hash = ?", [hashToken(token)]);
  }
}
