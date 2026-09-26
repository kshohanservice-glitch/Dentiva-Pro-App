# Dentiva Pro — Release Checklist (release gate)

Release version: 1.0.0 · Target: Windows 10/11 x64 (NSIS installer)

## 1. Automated gates (must ALL pass)

- [ ] `npm run typecheck` — clean
- [ ] `npm run lint` — 0 errors
- [ ] `npm test` — all suites pass (acceptance test skips without the secret)
- [ ] `npm run audit:licenses` / `audit:secrets` / `audit:todo` — pass
- [ ] `npm run build` — `dist-web/` produced without errors
- [ ] `cargo fmt --check`, `cargo clippy -- -D warnings`, `cargo test`, `cargo check` — pass
- [ ] Contract check: `src/api.ts` command names == Rust `#[tauri::command]` fns
      == `lib.rs` registrations (103/103, zero diff both directions)

## 2. Installer build

- [ ] Tag `v1.0.0` pushed (or Release workflow dispatched manually)
- [ ] **Release** workflow green on `windows-latest`
- [ ] NSIS `.exe` attached to the GitHub Release (+ fallback copy in `/dist`)
- [ ] With the `DENTIVA_PRODUCT_CODE` secret set, the env-gated activation
      acceptance test ran and passed in the release workflow

## 3. Installed-app validation (fresh Windows machine/VM)

- [ ] Installer runs, installs per-machine, launches Dentiva Pro with app icon
- [ ] A1–A6: activation with the genuine code, setup wizard, auth/lock flows
- [ ] B1–B7: full patient journey incl. prescription print + attachment round-trip
- [ ] C1–C3: appointments, queue, dashboard sanity
- [ ] D1–D5: invoice → payment → dues; stock moves; ledger spot-check
- [ ] E1–E8: RBAC denial as non-owner; backup → restore round-trip; Bengali print
- [ ] F1: disable all network adapters → repeat core flows (must all work)
- [ ] F2–F3: click every tab/button; confirm BDT/৳ everywhere

## 4. Sign-off

- [ ] Acceptance matrix (`docs/ACCEPTANCE_MATRIX.md`) all PASS
- [ ] `docs/BUILD_STATUS.md` updated with the release log
- [ ] Release notes published on the GitHub Release

Record of the 1.0.0 validation run:

| Date | Machine | Result | Notes |
|---|---|---|---|
| 2026-09-26 | CI (ubuntu) + release workflow | PASS (automated gates) | Manual installed-app pass to be recorded here at ship time |
