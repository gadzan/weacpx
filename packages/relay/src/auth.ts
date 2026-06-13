import { createHash, randomBytes, scryptSync, timingSafeEqual } from "node:crypto";

// scrypt over argon2: built into node:crypto (zero native deps for a
// self-hosted server). Format embeds parameters for future migration:
// scrypt:<N>:<r>:<p>:<salt-b64url>:<key-b64url>
const SCRYPT_N = 16384;
const SCRYPT_R = 8;
const SCRYPT_P = 1;
const KEY_LENGTH = 32;

export function hashPassword(password: string): string {
  const salt = randomBytes(16);
  const key = scryptSync(password, salt, KEY_LENGTH, { N: SCRYPT_N, r: SCRYPT_R, p: SCRYPT_P });
  return `scrypt:${SCRYPT_N}:${SCRYPT_R}:${SCRYPT_P}:${salt.toString("base64url")}:${key.toString("base64url")}`;
}

export function verifyPassword(password: string, stored: string): boolean {
  const parts = stored.split(":");
  if (parts.length !== 6 || parts[0] !== "scrypt") return false;
  const n = Number(parts[1]);
  const r = Number(parts[2]);
  const p = Number(parts[3]);
  if (!Number.isInteger(n) || !Number.isInteger(r) || !Number.isInteger(p)) return false;
  let salt: Buffer;
  let expected: Buffer;
  try {
    salt = Buffer.from(parts[4] ?? "", "base64url");
    expected = Buffer.from(parts[5] ?? "", "base64url");
    if (salt.length === 0 || expected.length === 0) return false;
    const actual = scryptSync(password, salt, expected.length, { N: n, r, p });
    return timingSafeEqual(actual, expected);
  } catch {
    return false;
  }
}

/** 32 random bytes, base64url — used for invites, pairing tokens, credentials, web sessions. */
export function generateToken(): string {
  return randomBytes(32).toString("base64url");
}

/** Tokens are stored hashed at rest; sha256 suffices for high-entropy random tokens. */
export function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}
