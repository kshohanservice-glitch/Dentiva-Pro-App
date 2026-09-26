# Dentiva Pro — Acceptance Matrix

Every row must be **PASS** before a release. `Auto` = covered by the automated
suite; `Manual` = exercised on the installed `.exe` per `docs/RELEASE_CHECKLIST.md`.

## First run & access

| # | Criterion | Type |
|---|---|---|
| A1 | Fresh install opens the Activation screen; nothing else is reachable | Manual |
| A2 | Wrong code is rejected with `ACTIVATION_INVALID`; right code activates one-time | Auto + Manual |
| A3 | Setup wizard completes exactly once (clinic, dentists, owner, preferences) | Auto + Manual |
| A4 | Bad credentials rejected; repeated failures lock the account with cooldown | Auto + Manual |
| A5 | Lock/unlock round-trip works; locked app blocks every command with `LOCKED` | Auto + Manual |
| A6 | Password change requires current password; old password stops working | Auto |

## Patients & clinical

| # | Criterion | Type |
|---|---|---|
| B1 | Register patient → auto code, duplicate-name/phone warning shown | Auto + Manual |
| B2 | Patient timeline aggregates visits, chart, prescriptions, treatments, payments | Auto |
| B3 | Adult + pediatric chart entry, history per tooth, notes | Manual |
| B4 | Visits CRUD with dentist + diagnosis; treatment records with pricing | Auto + Manual |
| B5 | Prescription with 2+ medications saves and prints clinical-grade A4 | Auto + Manual |
| B6 | Referrals, vitals/notes, attachments upload/download round-trip | Manual |
| B7 | Merge duplicate into master; archive hides from default lists | Auto + Manual |

## Scheduling

| # | Criterion | Type |
|---|---|---|
| C1 | Appointment book/edit/cancel with statuses; day view + queue flow | Manual |
| C2 | Queue advances (waiting → in-chair → done); missed appointments flagged | Manual |
| C3 | Dashboard shows today's counts; notifications refresh correctly | Manual |

## Billing, inventory, accounting

| # | Criterion | Type |
|---|---|---|
| D1 | Invoice from treatments; discount/tax math in paisa; totals in ৳ | Auto + Manual |
| D2 | Payments across Cash/Bank/Card/bKash/Nagad/Rocket/Upay; dues age correctly | Auto + Manual |
| D3 | Stock receive/issue/adjust with batches, expiry, reorder alerts | Auto + Manual |
| D4 | Suppliers CRUD; low-stock + expiring-soon notifications appear | Manual |
| D5 | Income/expense ledger entries; category + date-range reports balance | Manual |

## Admin, safety, printing

| # | Criterion | Type |
|---|---|---|
| E1 | Roles/permissions: denied command returns `PERMISSION_DENIED` below UI layer | Auto + Manual |
| E2 | Staff CRUD with sensitive-field redaction for unauthorized roles | Manual |
| E3 | Backup creates one file; validate passes; restore keeps pre-restore copy | Auto + Manual |
| E4 | Audit log records actor/action/entity for mutating commands | Auto + Manual |
| E5 | Printer profiles + templates; preview; A4/A5/thermal; Bengali text renders | Manual |
| E6 | Global search finds patients/invoices/appointments across modules | Manual |
| E7 | Settings persist (clinic, printer, backup schedule, formats); logo round-trip | Manual |
| E8 | About screen shows product, version, author (Shohan Khan) | Manual |

## Non-functional

| # | Criterion | Type |
|---|---|---|
| F1 | Full pass with the network disabled (offline-first) | Manual |
| F2 | No dead buttons/tabs; every control performs its labeled action | Manual |
| F3 | Currency is BDT/৳ everywhere; no other currency symbols | Manual |
| F4 | `typecheck`, `lint` (0 errors), `test`, 3 audits, `cargo test` all green | Auto |
| F5 | secret-scan confirms the activation code is absent from the repo | Auto |
