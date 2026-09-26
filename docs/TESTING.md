# Dentiva Pro — Testing Strategy

## Pyramid

1. **Unit tests** (`tests/unit/`, vitest, Node env) — pure logic with no I/O:
   - `hash.test.ts` — SHA-256 vectors, timing-safe compare, activation derivation
     known-answer vector + verifier well-formedness (the genuine product code
     never appears in source; see `SECURITY.md`).
   - `money.test.ts` — paisa formatting/parsing, BDT ৳ rendering.
   - `validation.test.ts` — field validators (phone, dates, required text).
   - `permissions.test.ts` — permission catalog shape, Owner `*` semantics.
   - `print.test.ts` — print template helpers (paper sizes, money-in-words).
2. **Integration tests** (`tests/integration/workflows.test.ts`) — full
   workflows through the real command layer against the fallback backend
   (sql.js), which mirrors the Rust backend's contract and permission checks:
   activation & one-time setup, auth/lock/password rotation, patient journey
   (register → visit → chart → prescription → treatment → referral → timeline →
   merge), billing (invoice → payments → dues), inventory moves, backup →
   validate → restore with pre-restore safety, RBAC denials below the UI layer.
3. **Release acceptance** (`tests/integration/activation-acceptance.test.ts`) —
   env-gated (`DENTIVA_PRODUCT_CODE` CI secret): proves the genuine code
   activates end-to-end. Skips silently without the secret.
4. **Rust tests** (`src-tauri`, `cargo test`) — activation rejection vectors and
   backend unit tests; run in CI and in the release workflow.
5. **Manual release gate** (`docs/RELEASE_CHECKLIST.md`) — scripted UI pass on
   the installed `.exe`: activation with the real code, setup wizard, every
   module smoke test, printing, backup/restore round-trip, offline run with the
   network disabled, RBAC spot checks.

## Running

```bash
npm run test:unit          # fast pure-logic suite
npm run test:integration   # full workflow suite (sql.js, ~60s budget)
npm test                   # everything
DENTIVA_PRODUCT_CODE=<code> npm test   # + genuine-code acceptance (release only)
cd src-tauri && cargo test # Rust suite
```

## Rules

- No mock data in production paths; tests build their own fixtures via commands.
- Every new command needs contract coverage: success + permission-denied +
  validation-error paths.
- The fallback backend and the Rust backend must stay behavior-identical; the
  103-command contract (`src/api.ts` ↔ `src-tauri`) is verified by the
  contract check in CI review and the release checklist.
