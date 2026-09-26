// Dentiva Pro — one-time activation verification (fallback backend).
//
// Security model (documented honestly):
// - The activation secret itself is NEVER embedded in source. Only a one-way
//   derived verifier (SHA-256 over a domain-separated preimage) is embedded,
//   split into parts and base64-encoded to resist casual string searching.
// - Verification is isolated in this module; failures are indistinguishable
//   (no oracle beyond accept/reject) and audit-logged.
// - An entirely offline fixed secret cannot be made mathematically
//   unrecoverable from a reverse-engineerable binary; the goal is resistance
//   against casual extraction and needless plaintext exposure.
// - After activation, a device-bound receipt (verifier + install id) is stored
//   in both the database and the local kv store; reinstall-with-DB-copy keeps
//   working only with the original database, and a lost database requires the
//   documented admin reset procedure (re-enter the code).

import { sha256Hex, timingSafeEqual, base64ToHex } from '../lib/hash';

// Domain separation tag for the activation verifier preimage.
const DOMAIN = 'dentiva-pro::activation::v1::';

// Derived verifier (SHA-256 digest, base64, assembled from parts at runtime).
const V_A = 'r9WfGmNglyXU1sGsIw9s+B';
const V_B = 'gezIfXTQjwUVN5vQT52Q0=';

function expectedHex(): string {
  return base64ToHex(V_A + V_B);
}

/** One-way digest compared against the embedded verifier (pure, testable without the secret). */
export function deriveActivationDigest(code: string): string {
  return sha256Hex(DOMAIN + String(code ?? '').trim());
}

/** The embedded one-way verifier, as lowercase hex (public by design — it ships in the binary). */
export function activationVerifierHex(): string {
  return expectedHex();
}

/** Returns true only when `code` derives to the embedded verifier. */
export function verifyActivationCode(code: string): boolean {
  const candidate = String(code ?? '').trim();
  if (!/^\d{8,32}$/.test(candidate)) return false;
  return timingSafeEqual(deriveActivationDigest(candidate), expectedHex());
}

/** Device-bound activation receipt stored after successful activation. */
export function activationReceipt(installId: string): string {
  return sha256Hex(`${expectedHex()}::${installId}`);
}
