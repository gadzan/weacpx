// Minimal SQLite adapter: bun:sqlite when running under Bun (tests, optional
// deployment), node:sqlite under Node (primary deployment). node:sqlite is NOT
// implemented by Bun 1.3, hence the runtime switch.
export interface SqlDriver {
  exec(sql: string): void;
  run(sql: string, params?: ReadonlyArray<string | number | null>): void;
  get<T>(sql: string, params?: ReadonlyArray<string | number | null>): T | undefined;
  all<T>(sql: string, params?: ReadonlyArray<string | number | null>): T[];
  close(): void;
}

type SqlParams = ReadonlyArray<string | number | null>;

export async function createSqlDriver(path: string): Promise<SqlDriver> {
  if (typeof Bun !== "undefined") {
    const { Database } = await import("bun:sqlite");
    const db = new Database(path);
    return {
      exec: (sql) => db.exec(sql),
      run: (sql, params: SqlParams = []) => {
        db.query(sql).run(...(params as (string | number | null)[]));
      },
      get: <T>(sql: string, params: SqlParams = []) =>
        (db.query(sql).get(...(params as (string | number | null)[])) ?? undefined) as T | undefined,
      all: <T>(sql: string, params: SqlParams = []) =>
        db.query(sql).all(...(params as (string | number | null)[])) as T[],
      close: () => db.close(),
    };
  }
  const { DatabaseSync } = await import("node:sqlite");
  const db = new DatabaseSync(path);
  return {
    exec: (sql) => db.exec(sql),
    run: (sql, params: SqlParams = []) => {
      db.prepare(sql).run(...(params as (string | number | null)[]));
    },
    get: <T>(sql: string, params: SqlParams = []) =>
      (db.prepare(sql).get(...(params as (string | number | null)[])) ?? undefined) as T | undefined,
    all: <T>(sql: string, params: SqlParams = []) =>
      db.prepare(sql).all(...(params as (string | number | null)[])) as T[],
    close: () => db.close(),
  };
}

export function initSchema(db: SqlDriver): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS accounts (
      id TEXT PRIMARY KEY,
      username TEXT NOT NULL UNIQUE,
      password_hash TEXT NOT NULL,
      role TEXT NOT NULL CHECK (role IN ('admin','member')),
      created_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS invites (
      token_hash TEXT PRIMARY KEY,
      created_by TEXT NOT NULL REFERENCES accounts(id),
      expires_at TEXT NOT NULL,
      used_by TEXT
    );
    CREATE TABLE IF NOT EXISTS web_sessions (
      token_hash TEXT PRIMARY KEY,
      account_id TEXT NOT NULL REFERENCES accounts(id),
      expires_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS pairing_tokens (
      token_hash TEXT PRIMARY KEY,
      account_id TEXT NOT NULL REFERENCES accounts(id),
      name TEXT,
      expires_at TEXT NOT NULL,
      used_at TEXT
    );
    CREATE TABLE IF NOT EXISTS instances (
      id TEXT PRIMARY KEY,
      account_id TEXT NOT NULL REFERENCES accounts(id),
      name TEXT NOT NULL,
      credential_hash TEXT NOT NULL,
      core_version TEXT,
      last_seen_at TEXT,
      created_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS messages (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      instance_id TEXT NOT NULL REFERENCES instances(id),
      session_alias TEXT NOT NULL,
      direction TEXT NOT NULL CHECK (direction IN ('in','out')),
      text TEXT NOT NULL,
      created_at TEXT NOT NULL,
      structured TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_messages_session ON messages (instance_id, session_alias, id);
  `);
  // Migration: older deployments have `messages` without `structured`.
  const hasStructured = db
    .all<{ name: string }>("PRAGMA table_info(messages)")
    .some((c) => c.name === "structured");
  if (!hasStructured) {
    db.exec("ALTER TABLE messages ADD COLUMN structured TEXT");
  }
}
