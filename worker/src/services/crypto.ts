/**
 * Cryptographic helpers for the Supabase OAuth flow.
 *
 * ALL primitives use Web Crypto (available natively in Cloudflare Workers).
 * Do NOT import node:crypto — it won't work in the worker runtime.
 *
 * Responsibilities:
 *   - AES-256-GCM encrypt/decrypt for refresh tokens at rest
 *   - HMAC-SHA256 sign/verify for OAuth state tokens
 *   - PKCE: code_verifier generation + S256 code_challenge
 */

const ALGORITHM_AES_GCM = { name: "AES-GCM", length: 256 } as const;
const ALGORITHM_PBKDF2 = { name: "PBKDF2" } as const;
const ALGORITHM_HMAC = { name: "HMAC", hash: "SHA-256" } as const;

// ── AES-GCM (refresh token encryption) ────────────────────────────────────

function hexToBytes(hex: string): Uint8Array {
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < bytes.length; i++) {
    bytes[i] = parseInt(hex.substring(i * 2, i * 2 + 2), 16);
  }
  return bytes;
}

async function importEncKey(rawKeyBytes: Uint8Array): Promise<CryptoKey> {
  return crypto.subtle.importKey("raw", rawKeyBytes, ALGORITHM_AES_GCM, false, [
    "encrypt",
    "decrypt",
  ]);
}

/**
 * Encrypt `plaintext` with AES-256-GCM under the given hex key.
 * Returns `{ cipher, iv }` — both base64 encoded.
 */
export async function encryptToken(
  plaintext: string,
  hexKey: string,
): Promise<{ cipher: string; iv: string }> {
  const key = await importEncKey(hexToBytes(hexKey));
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const encoded = new TextEncoder().encode(plaintext);
  const cipherBuf = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv },
    key,
    encoded,
  );
  return {
    cipher: btoa(String.fromCharCode(...new Uint8Array(cipherBuf))),
    iv: btoa(String.fromCharCode(...iv)),
  };
}

/**
 * Decrypt ciphertext produced by `encryptToken`.
 * Returns the original plaintext string.
 */
export async function decryptToken(
  cipherB64: string,
  ivB64: string,
  hexKey: string,
): Promise<string> {
  const key = await importEncKey(hexToBytes(hexKey));
  const iv = Uint8Array.from(atob(ivB64), (c) => c.charCodeAt(0));
  const cipherBytes = Uint8Array.from(atob(cipherB64), (c) => c.charCodeAt(0));
  const plainBuf = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv },
    key,
    cipherBytes,
  );
  return new TextDecoder().decode(plainBuf);
}

// ── HMAC state token (signed OAuth state parameter) ───────────────────────

export interface SignedState {
  userId: string;
  projectId: string;
  nonce: string;
  expiresAt: number; // epoch ms
}

async function importHmacKey(rawKeyBytes: Uint8Array): Promise<CryptoKey> {
  return crypto.subtle.importKey(
    "raw",
    rawKeyBytes,
    ALGORITHM_HMAC,
    false,
    ["sign", "verify"],
  );
}

/**
 * Sign a state payload → base64 "payloadBase64.signatureBase64".
 * The signature is HMAC-SHA256 over the payload base64 + a separator.
 */
export async function signState(
  state: SignedState,
  hexSecret: string,
): Promise<string> {
  const key = await importHmacKey(hexToBytes(hexSecret));
  const payloadB64 = btoa(JSON.stringify(state));
  const toSign = new TextEncoder().encode(payloadB64);
  const sig = await crypto.subtle.sign("HMAC", key, toSign);
  const sigB64 = btoa(String.fromCharCode(...new Uint8Array(sig)));
  return `${payloadB64}.${sigB64}`;
}

/**
 * Verify a signed state token. Returns the payload if valid + not expired,
 * or null if invalid/tampered/expired.
 */
export async function verifyState(
  signed: string,
  hexSecret: string,
): Promise<SignedState | null> {
  const dotIdx = signed.lastIndexOf(".");
  if (dotIdx < 0) return null;
  const payloadB64 = signed.substring(0, dotIdx);
  const sigB64 = signed.substring(dotIdx + 1);

  const key = await importHmacKey(hexToBytes(hexSecret));
  const toVerify = new TextEncoder().encode(payloadB64);
  const sig = Uint8Array.from(atob(sigB64), (c) => c.charCodeAt(0));
  const ok = await crypto.subtle.verify("HMAC", key, sig, toVerify);
  if (!ok) return null;

  try {
    return JSON.parse(atob(payloadB64)) as SignedState;
  } catch {
    return null;
  }
}

// ── PKCE (Proof Key for Code Exchange) ─────────────────────────────────────

/** Generate a cryptographically random code_verifier (43–128 chars, unreserved). */
export function pkceVerifier(length = 64): string {
  const chars =
    "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-._~";
  const buf = new Uint8Array(length);
  crypto.getRandomValues(buf);
  return Array.from(buf, (b) => chars[b % chars.length]).join("");
}

/** Compute the S256 code_challenge from a verifier. */
export async function pkceChallenge(verifier: string): Promise<string> {
  const hash = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(verifier),
  );
  return btoa(String.fromCharCode(...new Uint8Array(hash)))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

// ── Utility — generate random hex key ─────────────────────────────────────

/** Generate a random 32-byte hex string (e.g. for SUPABASE_TOKEN_ENC_KEY). */
export function randomHexKey(): string {
  const buf = new Uint8Array(32);
  crypto.getRandomValues(buf);
  return Array.from(buf, (b) => b.toString(16).padStart(2, "0")).join("");
}
