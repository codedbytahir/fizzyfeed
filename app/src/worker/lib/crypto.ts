/**
 * AES-256-GCM crypto for the token store (spec 01 §6.1, spec 02 §4) and HMAC
 * cookie signing (spec 01 §5). Uses WebCrypto — runs on Workers AND in Node ≥ 18
 * (vitest) because globalThis.crypto is available in both.
 *
 * Envelope design:
 *   - master key material: TOKEN_AES_KEY (32-byte base64 secret)
 *   - per-row random 16-byte salt → PBKDF2-SHA256 (310k iters) → AES-256-GCM key
 *   - per-encryption fresh 12-byte IV
 *   - AAD binds the row owner: encrypt(..., aad = user_id) — ciphertext is
 *     undecryptable under any other AAD (tamper + swap protection)
 */

const PBKDF2_ITERATIONS = 310_000;
const IV_BYTES = 12;
const SALT_BYTES = 16;

export function assertBase64Key(keyB64: string, expectedBytes = 32): void {
  const raw = base64Decode(keyB64);
  if (raw.byteLength !== expectedBytes) {
    throw new Error(`key must be ${expectedBytes} bytes base64, got ${raw.byteLength}`);
  }
}

async function deriveKey(keyB64: string, salt: Uint8Array): Promise<CryptoKey> {
  const material = base64Decode(keyB64);
  const base = await crypto.subtle.importKey("raw", material, "PBKDF2", false, ["deriveKey"]);
  return crypto.subtle.deriveKey(
    { name: "PBKDF2", salt: salt as BufferSource, iterations: PBKDF2_ITERATIONS, hash: "SHA-256" },
    base,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"]
  );
}

export interface SealedBox {
  iv: Uint8Array; // 12 bytes
  salt: Uint8Array; // 16 bytes
  ct: Uint8Array; // ciphertext + 16-byte GCM tag
}

/** Encrypt plaintext under TOKEN_AES_KEY with per-row salt, fresh IV, and AAD. */
export async function seal(
  keyB64: string,
  plaintext: string,
  aad: string
): Promise<SealedBox> {
  const salt = crypto.getRandomValues(new Uint8Array(SALT_BYTES));
  const iv = crypto.getRandomValues(new Uint8Array(IV_BYTES));
  const key = await deriveKey(keyB64, salt);
  const ct = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv: iv as BufferSource, additionalData: new TextEncoder().encode(aad) as BufferSource },
    key,
    new TextEncoder().encode(plaintext) as BufferSource
  );
  return { iv, salt, ct: new Uint8Array(ct) };
}

/** Decrypt a sealed box. Throws on ANY tampering, wrong key, or wrong AAD. */
export async function unseal(
  keyB64: string,
  box: SealedBox,
  aad: string
): Promise<string> {
  const key = await deriveKey(keyB64, box.salt);
  const pt = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv: box.iv as BufferSource, additionalData: new TextEncoder().encode(aad) as BufferSource },
    key,
    box.ct as BufferSource
  );
  return new TextDecoder().decode(pt);
}

// ── HMAC (cookie signing, spec 01 §5) ───────────────────────────────────────

async function hmacKey(secretB64: string): Promise<CryptoKey> {
  const raw = base64Decode(secretB64);
  return crypto.subtle.importKey("raw", raw, { name: "HMAC", hash: "SHA-256" }, false, ["sign", "verify"]);
}

/** base64url(no padding) HMAC-SHA256 signature of `payload`. */
export async function hmacSign(secretB64: string, payload: string): Promise<string> {
  const key = await hmacKey(secretB64);
  const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(payload) as BufferSource);
  return bytesToBase64Url(new Uint8Array(sig));
}

/** Timing-safe-enough verify (constant-time compare of equal-length digests). */
export async function hmacVerify(secretB64: string, payload: string, sigB64Url: string): Promise<boolean> {
  const expected = await hmacSign(secretB64, payload);
  if (expected.length !== sigB64Url.length) return false;
  let diff = 0;
  for (let i = 0; i < expected.length; i++) {
    diff |= expected.charCodeAt(i) ^ sigB64Url.charCodeAt(i);
  }
  return diff === 0;
}

// ── encoding helpers ────────────────────────────────────────────────────────

export function base64Decode(b64: string): Uint8Array {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

export function bytesToBase64Url(bytes: Uint8Array): string {
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export function base64UrlToBytes(s: string): Uint8Array {
  const b64 = s.replace(/-/g, "+").replace(/_/g, "/") + "=".repeat((4 - (s.length % 4)) % 4);
  return base64Decode(b64);
}

/** 32 random bytes → base64url (state/verifier generation, spec 02 §3). */
export function randomToken(bytes = 32): string {
  return bytesToBase64Url(crypto.getRandomValues(new Uint8Array(bytes)));
}

/** Constant-time string compare for secrets. */
export function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}
