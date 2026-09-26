// Dentiva Pro — release-gate activation acceptance test.
//
// The genuine product code is supplied ONLY via the DENTIVA_PRODUCT_CODE
// environment variable (CI secret / release machine). It must NEVER be written
// into source — the secret-scan audit fails the build if a 16-digit code
// literal appears anywhere in the repo. When the variable is absent this test
// skips silently (local dev); CI release runs and the manual release gate
// exercise the real code.

import { describe, it, expect } from 'vitest';
import { browserInvoke, __resetForTests } from '../../src/backend/browserBackend';

const PRODUCT_CODE = process.env.DENTIVA_PRODUCT_CODE ?? '';

describe('activation acceptance (release gate)', () => {
  it.skipIf(!PRODUCT_CODE)('accepts the genuine product code', async () => {
    await __resetForTests();
    await browserInvoke('activate', { code: PRODUCT_CODE });
    const s = (await browserInvoke('app_status', {})) as { activated: boolean };
    expect(s.activated).toBe(true);
  });
});
