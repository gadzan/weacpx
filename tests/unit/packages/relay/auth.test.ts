import { expect, test } from "bun:test";

import { generateToken, hashPassword, hashToken, verifyPassword } from "../../../../packages/relay/src/auth";

test("password hash verifies and rejects wrong password", () => {
  const stored = hashPassword("hunter2");
  expect(stored.startsWith("scrypt:")).toBe(true);
  expect(verifyPassword("hunter2", stored)).toBe(true);
  expect(verifyPassword("hunter3", stored)).toBe(false);
});

test("same password hashes differently (random salt)", () => {
  expect(hashPassword("x")).not.toBe(hashPassword("x"));
});

test("verifyPassword rejects malformed stored values", () => {
  expect(verifyPassword("x", "")).toBe(false);
  expect(verifyPassword("x", "argon2:whatever")).toBe(false);
  expect(verifyPassword("x", "scrypt:bad")).toBe(false);
  expect(verifyPassword("x", "scrypt:1:8:1:AAAA:BBBB")).toBe(false); // valid format, invalid scrypt N — must not throw
});

test("tokens are url-safe, unique, and hash deterministically", () => {
  const a = generateToken();
  const b = generateToken();
  expect(a).not.toBe(b);
  expect(a).toMatch(/^[A-Za-z0-9_-]{40,}$/);
  expect(hashToken(a)).toBe(hashToken(a));
  expect(hashToken(a)).not.toBe(hashToken(b));
  expect(hashToken(a)).toMatch(/^[0-9a-f]{64}$/);
});
