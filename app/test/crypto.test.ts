/**
 * T05 — crypto layer unit tests (spec 01 §6, spec 02 §3+§4).
 * Covers the AES-256-GCM token store (PBKDF2 per-row salt, fresh IV, AAD
 * binding to user_id), HMAC cookie signing, base64url helpers, random tokens
 * and the constant-time compare. Key material is random per run — no secret
 * literals in the repo (agent-check §4). Note: this repo's worker tsconfig
 * has no @types/node, so keys are built with btoa instead of Buffer.
 */
import { describe, expect, it } from "vitest";
import {
  assertBase64Key,
  base64Decode,
  base64UrlToBytes,
  bytesToBase64Url,
  hmacSign,
  hmacVerify,
  randomToken,
  seal,
  timingSafeEqual,
  unseal,
} from "../src/worker/lib/crypto";

const AAD = "user_test_1";

/** Standard-base64 of `bytes` random bytes — the TOKEN_AES_KEY format. */
function randomKeyB64(bytes = 32): string {
  const raw = crypto.getRandomValues(new Uint8Array(bytes));
  let bin = "";
  for (const b of raw) bin += String.fromCharCode(b);
  return btoa(bin);
}

function bytesEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    if (a[i] !== b[i]) return false;
  }
  return true;
}

/** Copy of `bytes` with the byte at `index` flipped (XOR 1 — always changes). */
function flipped(bytes: Uint8Array, index: number): Uint8Array {
  const copy = bytes.slice();
  const current = copy[index];
  if (current === undefined) throw new Error(`index ${index} out of range`);
  copy[index] = current ^ 0x01;
  return copy;
}

/** A different string at `index`, staying inside the base64url alphabet. */
function flipCharAt(s: string, index: number): string {
  const ch = s[index];
  if (ch === undefined) throw new Error(`index ${index} out of range`);
  return s.slice(0, index) + (ch === "A" ? "B" : "A") + s.slice(index + 1);
}

function stdB64(bytes: Uint8Array): string {
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin);
}

describe("seal → unseal (AES-256-GCM token store)", () => {
  it.each([
    ["empty plaintext", ""],
    ["short token", "atkn_9f8Aq2Lx"],
    ["unicode + newlines", "refresh: ünïcode 🫧\nline2"],
    ["4 KiB blob", "x".repeat(4096) + "🫧"],
  ])("round-trips the exact plaintext (%s)", async (_label, plaintext) => {
    const key = randomKeyB64();
    const box = await seal(key, plaintext, AAD);
    expect(box.iv.length).toBe(12); // spec 02 §4: fresh 12-byte IV
    expect(box.salt.length).toBe(16); // spec 02 §4: fresh 16-byte salt
    await expect(unseal(key, box, AAD)).resolves.toBe(plaintext);
  });

  it("uses a fresh salt + IV per call (same input → different ciphertext)", async () => {
    const key = randomKeyB64();
    const a = await seal(key, "same plaintext", AAD);
    const b = await seal(key, "same plaintext", AAD);
    expect(bytesEqual(a.iv, b.iv)).toBe(false);
    expect(bytesEqual(a.salt, b.salt)).toBe(false);
    expect(bytesEqual(a.ct, b.ct)).toBe(false);
  });
});

describe("tamper-evidence (GCM auth tag + AAD + key binding)", () => {
  it("throws for a tampered byte at ANY position of ct", async () => {
    const key = randomKeyB64();
    const box = await seal(key, "x", AAD); // ct = 1 payload byte + 16-byte tag
    for (let i = 0; i < box.ct.length; i++) {
      await expect(
        unseal(key, { ...box, ct: flipped(box.ct, i) }, AAD),
        `tampered ct byte ${i} must throw`
      ).rejects.toThrow();
    }
  });

  it("throws for a tampered byte at ANY position of iv", async () => {
    const key = randomKeyB64();
    const box = await seal(key, "x", AAD);
    for (let i = 0; i < box.iv.length; i++) {
      await expect(
        unseal(key, { ...box, iv: flipped(box.iv, i) }, AAD),
        `tampered iv byte ${i} must throw`
      ).rejects.toThrow();
    }
  });

  it("throws for a tampered byte at ANY position of salt", async () => {
    const key = randomKeyB64();
    const box = await seal(key, "x", AAD);
    for (let i = 0; i < box.salt.length; i++) {
      await expect(
        unseal(key, { ...box, salt: flipped(box.salt, i) }, AAD),
        `tampered salt byte ${i} must throw`
      ).rejects.toThrow();
    }
  });

  it("throws when unsealed under a different AAD (row swap between users)", async () => {
    const key = randomKeyB64();
    const box = await seal(key, "secret-token", "user_a");
    await expect(unseal(key, box, "user_b")).rejects.toThrow(); // spec 02 §4: AAD = user_id
  });

  it("throws when unsealed under a different key", async () => {
    const box = await seal(randomKeyB64(), "secret-token", AAD);
    await expect(unseal(randomKeyB64(), box, AAD)).rejects.toThrow();
  });
});

describe("hmacSign / hmacVerify (cookie signing, spec 01 §5)", () => {
  const secret = randomKeyB64();
  const payload = "user_abc.1735689600";

  it("verifies its own signature", async () => {
    const sig = await hmacSign(secret, payload);
    await expect(hmacVerify(secret, payload, sig)).resolves.toBe(true);
  });

  it("rejects any payload change", async () => {
    const sig = await hmacSign(secret, payload);
    await expect(hmacVerify(secret, "user_abd.1735689600", sig)).resolves.toBe(false);
    await expect(hmacVerify(secret, "user_abc.1735689601", sig)).resolves.toBe(false);
  });

  it("rejects any signature change or truncation", async () => {
    const sig = await hmacSign(secret, payload);
    await expect(hmacVerify(secret, payload, flipCharAt(sig, 0))).resolves.toBe(false);
    await expect(hmacVerify(secret, payload, flipCharAt(sig, sig.length - 1))).resolves.toBe(false);
    await expect(hmacVerify(secret, payload, sig.slice(0, -1))).resolves.toBe(false);
  });

  it("rejects a signature made under a different secret", async () => {
    const sig = await hmacSign(randomKeyB64(), payload);
    await expect(hmacVerify(secret, payload, sig)).resolves.toBe(false);
  });
});

describe("base64url helpers", () => {
  it.each([0, 11, 32, 76])("round-trips %i bytes", (n) => {
    const bytes = crypto.getRandomValues(new Uint8Array(n));
    const encoded = bytesToBase64Url(bytes);
    expect(encoded).not.toMatch(/[+/=]/); // url-safe alphabet, padding stripped
    expect(bytesEqual(base64UrlToBytes(encoded), bytes)).toBe(true);
  });

  it("maps +, / and padding to the url-safe form exactly like btoa→replace", () => {
    const raw = new Uint8Array(256);
    for (let i = 0; i < 256; i++) raw[i] = i;
    const expected = stdB64(raw).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
    expect(bytesToBase64Url(raw)).toBe(expected);
    expect(expected).toContain("-"); // the alphabet really changed
    expect(expected).toContain("_");
    expect(bytesEqual(base64Decode(stdB64(raw)), raw)).toBe(true); // std base64 decode
  });

  it("decodes back to the original byte values", () => {
    const bytes = new Uint8Array([0, 1, 250, 251, 252, 253, 254, 255]);
    expect(bytesEqual(base64UrlToBytes(bytesToBase64Url(bytes)), bytes)).toBe(true);
  });
});

describe("randomToken (state/verifier generation, spec 02 §3)", () => {
  it("produces url-safe base64 decoding to exactly 32 bytes", () => {
    const token = randomToken(32);
    expect(token).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(token).not.toMatch(/[+/=]/);
    expect(base64UrlToBytes(token).length).toBe(32);
    expect(token.length).toBe(43); // ceil(32 * 4 / 3)
  });

  it("produces distinct tokens across calls", () => {
    expect(randomToken(32)).not.toBe(randomToken(32));
  });
});

describe("timingSafeEqual", () => {
  it("is true for identical strings (including empty)", () => {
    expect(timingSafeEqual("same-secret", "same-secret")).toBe(true);
    expect(timingSafeEqual("", "")).toBe(true);
  });

  it("is false for different lengths", () => {
    expect(timingSafeEqual("abc", "abcd")).toBe(false);
    expect(timingSafeEqual("abcd", "abc")).toBe(false);
  });

  it("is false for a one-character difference", () => {
    expect(timingSafeEqual("abc", "abd")).toBe(false);
    expect(timingSafeEqual("abc", "abC")).toBe(false);
    expect(timingSafeEqual("Abc", "abc")).toBe(false);
  });
});

describe("assertBase64Key (TOKEN_AES_KEY / SESSION_SECRET shape)", () => {
  it("accepts a 32-byte base64 key", () => {
    expect(() => assertBase64Key(randomKeyB64(32))).not.toThrow();
  });

  it("rejects a 16-byte key", () => {
    expect(() => assertBase64Key(randomKeyB64(16))).toThrow(/32 bytes/);
  });

  it("honours a custom expected size", () => {
    expect(() => assertBase64Key(randomKeyB64(16), 16)).not.toThrow();
    expect(() => assertBase64Key(randomKeyB64(16), 32)).toThrow(/32 bytes/);
  });

  it("rejects input that is not decodable base64", () => {
    expect(() => assertBase64Key("not base64!!")).toThrow();
  });
});
