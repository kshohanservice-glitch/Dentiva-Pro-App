# Dentiva Pro — Security Model

## Activation (one-time, fully offline)

- The genuine product activation code **never appears in source code, tests,
  docs, or build scripts**. The `audit:secrets` script fails the build if a
  16-digit code literal is ever committed.
- Both backends (Rust native + web fallback) embed only a **one-way derived
  verifier**: `SHA-256("dentiva-pro::activation::v1::" + code)`, stored split
  into base64 parts and re-assembled at runtime (`src-tauri/src/activation.rs`,
  `src/backend/activation.ts`).
- Verification is isolated in those two modules, uses a timing-safe compare,
  and gives no oracle beyond accept/reject; failures are audit-logged.
- After activation, a device-bound receipt
  (`SHA-256(verifier_hex + "::" + install_id)`) is stored in the database and
  the local kv store.
- Honest limitation: an offline fixed secret inside a reverse-engineerable
  binary cannot be made mathematically unrecoverable; the goal is resistance
  against casual extraction and needless plaintext exposure.

### Testing without the secret

- Unit tests assert wrong-code rejection, a known-answer derivation vector for
  a dummy code, and verifier well-formedness — no secret needed.
- Integration tests activate through the test-only `__testActivate()` hook,
  which is **not reachable through any IPC command**.
- Genuine-code acceptance is covered two ways at release time:
  1. `tests/integration/activation-acceptance.test.ts`, which reads the code
     from the `DENTIVA_PRODUCT_CODE` environment variable (CI secret) and
     skips when absent;
  2. the manual release-gate step (enter the code in the Activation screen).

## Passwords & sessions

- Desktop build: Argon2id (`src-tauri/src/auth.rs`). Web fallback: PBKDF2-HMAC-SHA-256
  210,000 iterations via WebCrypto. Passwords are never logged or stored in plaintext.
- Repeated login failures lock the account with a growing cooldown; the app can
  be locked manually or automatically (configurable idle timeout).

## Data protection

- All data lives in a local SQLite database plus an attachments folder — no
  network calls, no telemetry, no cloud. The app works fully with the network
  disabled (verified by the release gate).
- Backups are single self-contained `.dentiva-backup` files (database +
  attachments manifest); restore always keeps a pre-restore safety backup.

## Reporting a vulnerability

Contact the author: Shohan Khan — helloiamshohan@gmail.com.
