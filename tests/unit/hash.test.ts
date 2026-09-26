import { describe, it, expect } from 'vitest';
import { sha256Hex, timingSafeEqual } from '../../src/lib/hash';
import { verifyActivationCode, deriveActivationDigest, activationVerifierHex } from '../../src/backend/activation';

describe('sha256 (pure-TS)', () => {
  it('matches known vectors', () => {
    expect(sha256Hex('')).toBe('e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855');
    expect(sha256Hex('abc')).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
  });

  it('compares in constant time semantics', () => {
    expect(timingSafeEqual('abc', 'abc')).toBe(true);
    expect(timingSafeEqual('abc', 'abd')).toBe(false);
    expect(timingSafeEqual('abc', 'abcd')).toBe(false);
  });
});

describe('activation verifier', () => {
  // NOTE: the genuine product code NEVER appears in source (see SECURITY.md).
  // Genuine-code acceptance is covered by the env-gated release test
  // (tests/integration/activation-acceptance.test.ts) and the manual release gate.
  // Dummy codes below are 15 digits so the secret-scan gate (which rejects any
  // 16-digit literal) stays meaningful.

  it('rejects malformed and wrong codes without throwing', () => {
    expect(verifyActivationCode('')).toBe(false);
    expect(verifyActivationCode('123')).toBe(false);
    expect(verifyActivationCode('000000000000007')).toBe(false);
    expect(verifyActivationCode('abcdefghijklmnop')).toBe(false);
    expect(verifyActivationCode('  12ab34  ')).toBe(false);
  });

  it('derives digests matching the domain-separated SHA-256 reference vector', () => {
    // Independent known-answer vector (dummy code, NOT the product code):
    // SHA256("dentiva-pro::activation::v1::" + "000000000000007").
    expect(deriveActivationDigest('000000000000007')).toBe(
      '7c7483622f95ebf5e3353961c97e52f82c072cc7bc5f198dfcf41bfe5657a0ae',
    );
    expect(deriveActivationDigest('  000000000000007  ')).toBe(deriveActivationDigest('000000000000007'));
  });

  it('embeds a well-formed 256-bit verifier (public by design)', () => {
    const v = activationVerifierHex();
    expect(v).toMatch(/^[0-9a-f]{64}$/);
  });
});
