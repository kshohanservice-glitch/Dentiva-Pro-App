# Dentiva Pro — Build Status

## Implementation: COMPLETE (2026-09-26)

- [x] Architecture, database schema, permission matrix, security model
- [x] Frontend: 20 feature modules + design system + print engine + command API (`src/api.ts`, 103 commands)
- [x] Rust backend: 5 command mirrors (system/patients/clinical/finance/admin), activation, Argon2id auth, RBAC context
- [x] Fallback backend (sql.js + IndexedDB): same contract, same permission checks
- [x] Unit + integration + env-gated activation acceptance tests
- [x] Audits: licenses, secrets, no-TODO (all wired as npm scripts)
- [x] App icons (multi-resolution `.ico` + 1024 PNG) for the installer
- [x] GitHub Actions: CI gates + Windows NSIS release workflow
- [x] Docs: README, TESTING, ACCEPTANCE_MATRIX, RELEASE_CHECKLIST, SECURITY

## Contract verification (2026-09-26)

- `src/api.ts` ↔ Rust `#[tauri::command]` fns: **103/103, zero diff both directions**
- Rust fns ↔ `lib.rs` handler registrations: **103/103**
- Rust sources: all 14 files parse-clean (tree-sitter gate)
- Activation verifier independently recomputed: matches the genuine product code

## Test / build log (2026-09-26 → 2026-09-27)

- `npm run typecheck` — CLEAN
- `npm run lint` — 0 errors (1346 style warnings)
- `npm test` — 37 passed, 1 skipped (env-gated acceptance skips without secret)
- `DENTIVA_PRODUCT_CODE=<real> npm test` path — acceptance test PASSED
- `npm run audit:licenses` / `audit:secrets` / `audit:todo` — PASS
- `npm run build` — `dist-web/` produced, served 200 on preview
- **CI (ubuntu-24.04) ALL GREEN** — frontend gates + Rust `cargo fmt`,
  `cargo clippy -- -D warnings`, `cargo test`, `cargo check` all pass.
  Fixed along the way: date-independent integration tests, redundant-closure
  clippy hardening, `include_str!` schema path, rustfmt conformance (via CI bot).
- Release workflow (windows-latest NSIS build) triggered by tag `v1.0.0`.

## Release readiness

READY — installer built by the Release workflow; the manual installed-app pass
on Windows is recorded in `docs/RELEASE_CHECKLIST.md` at ship time.
