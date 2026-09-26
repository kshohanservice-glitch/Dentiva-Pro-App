# Dentiva Pro — Offline Dental Clinic Management (Windows Desktop)

Dentiva Pro is a **production-ready, offline-first** dental clinic management
application for Windows: patients, visits, dental charting (adult + pediatric),
treatments, appointments, queue, clinical-grade prescriptions, invoices &
payments, inventory, accounting, staff with granular role-based access,
activation-guarded setup, backup/restore, and a full print engine — all in
Bangladeshi Taka (৳) with Bengali Unicode support.

- **Shell:** Tauri 2 (Rust + OS webview) → single NSIS `.exe` installer
- **Frontend:** React 19 + TypeScript + Vite (custom design system, no CSS framework)
- **Backend:** Rust command layer + SQLite (WAL, FK-enforced). All authorization
  is enforced **below the UI layer** — the frontend only calls the command API.
- **Fallback runtime:** when the Tauri runtime is absent (browser preview,
  automated tests), `src/backend/browserBackend.ts` implements the **same
  command contract with the same permission checks** over SQLite/WASM + IndexedDB.
- **Offline:** zero network calls, zero telemetry, zero paid APIs. Works fully
  with the network disabled.

Author: **Shohan Khan** — helloiamshohan@gmail.com

## Feature map

| Area | Highlights |
|---|---|
| Patients | Registration with auto codes, duplicates warning, tags, timeline, merge, archive, attachments |
| Clinical | Visits, adult + pediatric dental chart, treatments & procedures, referrals, vitals |
| Prescriptions | Multi-medication, bilingual-ready clinical print (A4/A5/thermal/custom) |
| Scheduling | Appointments, day queue with live statuses, reminders |
| Billing | Invoices, payments (Cash/Bank/Card/bKash/Nagad/Rocket/Upay), dues, refunds |
| Inventory | Items, batches, expiry tracking, stock in/out/adjust, suppliers, low-stock alerts |
| Accounting | Income/expense ledger, categories, financial reports |
| Staff & access | Users, roles, 60+ granular permissions enforced at the business layer |
| Activation | One-time offline activation code; setup wizard; Argon2id auth + lock |
| Safety | One-file backup/restore with pre-restore safety copy, audit log, notifications |
| Printing | Printer profiles, templates, preview, PDF export, Bengali-safe fonts |

## Quickstart

Prerequisites: Node 20+, npm. For the desktop build also the Rust stable toolchain.

```bash
npm install
npm run dev        # web preview (fallback backend) → http://localhost:1420
npm test           # unit + integration suites (37 tests)
npm run build      # production web bundle → dist-web/
npx tauri build    # Windows installer (run on Windows) → src-tauri/target/release/bundle
```

Release flow: push a `v*` tag (or dispatch **Release** manually) — GitHub Actions
builds and attaches the installer to the GitHub Release. See `dist/README.md`
for the local fallback procedure.

## Quality gates (all must pass)

```bash
npm run typecheck        # strict TypeScript
npm run lint             # oxlint — 0 errors
npm test                 # vitest — unit + integration
npm run audit:licenses   # no copyleft deps
npm run audit:secrets    # no secrets in source (activation code NEVER in repo)
npm run audit:todo       # no TODOs / placeholders / dead markers
```

Rust side (CI runs these): `cargo fmt --check`, `cargo clippy -- -D warnings`,
`cargo test`, `cargo check`. The genuine-code activation test reads the code
from the `DENTIVA_PRODUCT_CODE` CI secret and skips otherwise.

Docs: `docs/ARCHITECTURE.md`, `docs/PERMISSIONS.md`, `docs/TESTING.md`,
`docs/ACCEPTANCE_MATRIX.md`, `docs/RELEASE_CHECKLIST.md`, `SECURITY.md`.
