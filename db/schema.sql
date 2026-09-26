-- ============================================================================
-- Dentiva Pro — Canonical Database Schema (single source of truth)
-- Used by: Rust backend (src-tauri, via include_str!) and browser fallback
--          (src/backend via ?raw import). SQLite, FK enforced, WAL mode.
-- Money is stored as INTEGER paisa (1 BDT = 100 paisa). Dates: ISO TEXT.
-- ============================================================================

PRAGMA foreign_keys = OFF;

-- ---------------------------------------------------------------- key/value
CREATE TABLE IF NOT EXISTS meta (
    key   TEXT PRIMARY KEY,
    value TEXT NOT NULL
);

-- ------------------------------------------------------------------- clinic
CREATE TABLE IF NOT EXISTS clinic (
    id            INTEGER PRIMARY KEY CHECK (id = 1),
    name          TEXT NOT NULL DEFAULT 'Dental Care',
    address       TEXT NOT NULL DEFAULT '',
    phone         TEXT NOT NULL DEFAULT '',
    email         TEXT NOT NULL DEFAULT '',
    website       TEXT NOT NULL DEFAULT '',
    opening_hours TEXT NOT NULL DEFAULT '',
    closing_hours TEXT NOT NULL DEFAULT '',
    weekly_off    TEXT NOT NULL DEFAULT '',
    logo_path     TEXT,
    message       TEXT NOT NULL DEFAULT '',
    footer_text   TEXT NOT NULL DEFAULT '',
    created_at    TEXT NOT NULL,
    updated_at    TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS dentists (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    name            TEXT NOT NULL,
    phone           TEXT NOT NULL DEFAULT '',
    email           TEXT NOT NULL DEFAULT '',
    registration_no TEXT NOT NULL DEFAULT '',
    photo_path      TEXT,
    signature_path  TEXT,
    active          INTEGER NOT NULL DEFAULT 1,
    sort_order      INTEGER NOT NULL DEFAULT 0,
    created_at      TEXT NOT NULL,
    updated_at      TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS dentist_designations (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    dentist_id  INTEGER NOT NULL REFERENCES dentists(id) ON DELETE CASCADE,
    designation TEXT NOT NULL,
    sort_order  INTEGER NOT NULL DEFAULT 0
);

-- ------------------------------------------------------------------ RBAC
CREATE TABLE IF NOT EXISTS roles (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    name        TEXT NOT NULL UNIQUE,
    description TEXT NOT NULL DEFAULT '',
    system_role INTEGER NOT NULL DEFAULT 0,
    created_at  TEXT NOT NULL,
    updated_at  TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS permissions (
    code        TEXT PRIMARY KEY,
    name        TEXT NOT NULL,
    module      TEXT NOT NULL,
    description TEXT NOT NULL DEFAULT ''
);

CREATE TABLE IF NOT EXISTS role_permissions (
    role_id         INTEGER NOT NULL REFERENCES roles(id) ON DELETE CASCADE,
    permission_code TEXT NOT NULL REFERENCES permissions(code) ON DELETE CASCADE,
    PRIMARY KEY (role_id, permission_code)
);

CREATE TABLE IF NOT EXISTS users (
    id                   INTEGER PRIMARY KEY AUTOINCREMENT,
    full_name            TEXT NOT NULL,
    username             TEXT NOT NULL UNIQUE COLLATE NOCASE,
    password_hash        TEXT NOT NULL,
    role_id              INTEGER NOT NULL REFERENCES roles(id) ON DELETE RESTRICT,
    active               INTEGER NOT NULL DEFAULT 1,
    must_change_password INTEGER NOT NULL DEFAULT 0,
    failed_attempts      INTEGER NOT NULL DEFAULT 0,
    locked_until         TEXT,
    last_login_at        TEXT,
    created_at           TEXT NOT NULL,
    updated_at           TEXT NOT NULL
);

-- ------------------------------------------------------------------- staff
CREATE TABLE IF NOT EXISTS staff (
    id                INTEGER PRIMARY KEY AUTOINCREMENT,
    name              TEXT NOT NULL,
    photo_path        TEXT,
    dob               TEXT,
    gender            TEXT NOT NULL DEFAULT '',
    address           TEXT NOT NULL DEFAULT '',
    phone             TEXT NOT NULL DEFAULT '',
    emergency_contact TEXT NOT NULL DEFAULT '',
    emergency_phone   TEXT NOT NULL DEFAULT '',
    blood_group       TEXT NOT NULL DEFAULT '',
    nid_no            TEXT NOT NULL DEFAULT '',
    role_title        TEXT NOT NULL DEFAULT '',
    department        TEXT NOT NULL DEFAULT '',
    joining_date      TEXT,
    salary_paisa      INTEGER NOT NULL DEFAULT 0,
    notes             TEXT NOT NULL DEFAULT '',
    active            INTEGER NOT NULL DEFAULT 1,
    created_at        TEXT NOT NULL,
    updated_at        TEXT NOT NULL
);

-- ----------------------------------------------------------------- patients
CREATE TABLE IF NOT EXISTS patients (
    id                INTEGER PRIMARY KEY AUTOINCREMENT,
    code              TEXT NOT NULL UNIQUE,
    name              TEXT NOT NULL,
    dob               TEXT,
    age_years         INTEGER,
    gender            TEXT NOT NULL DEFAULT '',
    blood_group       TEXT NOT NULL DEFAULT '',
    address           TEXT NOT NULL DEFAULT '',
    phone             TEXT NOT NULL DEFAULT '',
    emergency_phone   TEXT NOT NULL DEFAULT '',
    emergency_contact TEXT NOT NULL DEFAULT '',
    complaint         TEXT NOT NULL DEFAULT '',
    prev_problems     TEXT NOT NULL DEFAULT '',
    medical_notes     TEXT NOT NULL DEFAULT '',
    dental_notes      TEXT NOT NULL DEFAULT '',
    allergies         TEXT NOT NULL DEFAULT '',
    notes             TEXT NOT NULL DEFAULT '',
    reg_date          TEXT NOT NULL,
    reg_user_id       INTEGER REFERENCES users(id) ON DELETE SET NULL,
    dentist_id        INTEGER REFERENCES dentists(id) ON DELETE SET NULL,
    referral_source   TEXT NOT NULL DEFAULT '',
    status            TEXT NOT NULL DEFAULT 'active',
    photo_path        TEXT,
    archived          INTEGER NOT NULL DEFAULT 0,
    created_at        TEXT NOT NULL,
    updated_at        TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS patient_tags (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    patient_id INTEGER NOT NULL REFERENCES patients(id) ON DELETE CASCADE,
    tag        TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS patient_extra_contacts (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    patient_id INTEGER NOT NULL REFERENCES patients(id) ON DELETE CASCADE,
    name       TEXT NOT NULL DEFAULT '',
    relation   TEXT NOT NULL DEFAULT '',
    phone      TEXT NOT NULL DEFAULT ''
);

CREATE TABLE IF NOT EXISTS patient_medical_notes (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    patient_id INTEGER NOT NULL REFERENCES patients(id) ON DELETE CASCADE,
    note       TEXT NOT NULL,
    created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
    created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS patient_attachments (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    patient_id    INTEGER NOT NULL REFERENCES patients(id) ON DELETE CASCADE,
    original_name TEXT NOT NULL,
    stored_name   TEXT NOT NULL,
    mime          TEXT NOT NULL DEFAULT '',
    size_bytes    INTEGER NOT NULL DEFAULT 0,
    sha256        TEXT NOT NULL DEFAULT '',
    category      TEXT NOT NULL DEFAULT 'document',
    note          TEXT NOT NULL DEFAULT '',
    uploaded_by   INTEGER REFERENCES users(id) ON DELETE SET NULL,
    created_at    TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS patient_referrals (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    patient_id  INTEGER NOT NULL REFERENCES patients(id) ON DELETE CASCADE,
    referred_by TEXT NOT NULL DEFAULT '',
    referred_to TEXT NOT NULL DEFAULT '',
    specialty   TEXT NOT NULL DEFAULT '',
    reason      TEXT NOT NULL DEFAULT '',
    referral_date TEXT NOT NULL,
    notes       TEXT NOT NULL DEFAULT '',
    follow_up   TEXT NOT NULL DEFAULT '',
    status      TEXT NOT NULL DEFAULT 'open',
    created_by  INTEGER REFERENCES users(id) ON DELETE SET NULL,
    created_at  TEXT NOT NULL
);

-- ------------------------------------------------------------- dental chart
CREATE TABLE IF NOT EXISTS tooth_condition_types (
    code  TEXT PRIMARY KEY,
    name  TEXT NOT NULL,
    color TEXT NOT NULL DEFAULT '#64748b',
    sort  INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS dental_chart_records (
    id             INTEGER PRIMARY KEY AUTOINCREMENT,
    patient_id     INTEGER NOT NULL REFERENCES patients(id) ON DELETE CASCADE,
    tooth_code     TEXT NOT NULL,
    condition_code TEXT NOT NULL DEFAULT 'healthy',
    notes          TEXT NOT NULL DEFAULT '',
    treatment_id   INTEGER REFERENCES treatment_catalog(id) ON DELETE SET NULL,
    dentist_id     INTEGER REFERENCES dentists(id) ON DELETE SET NULL,
    recorded_by    INTEGER REFERENCES users(id) ON DELETE SET NULL,
    recorded_at    TEXT NOT NULL
);

-- ------------------------------------------------------------------ visits
CREATE TABLE IF NOT EXISTS visits (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    patient_id      INTEGER NOT NULL REFERENCES patients(id) ON DELETE CASCADE,
    visit_date      TEXT NOT NULL,
    dentist_id      INTEGER REFERENCES dentists(id) ON DELETE SET NULL,
    complaint       TEXT NOT NULL DEFAULT '',
    history         TEXT NOT NULL DEFAULT '',
    examination     TEXT NOT NULL DEFAULT '',
    diagnosis       TEXT NOT NULL DEFAULT '',
    procedure_notes TEXT NOT NULL DEFAULT '',
    advice          TEXT NOT NULL DEFAULT '',
    follow_up_date  TEXT,
    referral_note   TEXT NOT NULL DEFAULT '',
    notes           TEXT NOT NULL DEFAULT '',
    created_by      INTEGER REFERENCES users(id) ON DELETE SET NULL,
    created_at      TEXT NOT NULL,
    updated_at      TEXT NOT NULL
);

-- --------------------------------------------------------------- treatments
CREATE TABLE IF NOT EXISTS treatment_catalog (
    id                 INTEGER PRIMARY KEY AUTOINCREMENT,
    code               TEXT NOT NULL UNIQUE,
    name               TEXT NOT NULL,
    category           TEXT NOT NULL DEFAULT 'General',
    default_price_paisa INTEGER NOT NULL DEFAULT 0,
    duration_min       INTEGER NOT NULL DEFAULT 30,
    notes              TEXT NOT NULL DEFAULT '',
    active             INTEGER NOT NULL DEFAULT 1,
    created_at         TEXT NOT NULL,
    updated_at         TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS treatment_records (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    visit_id      INTEGER REFERENCES visits(id) ON DELETE SET NULL,
    patient_id    INTEGER NOT NULL REFERENCES patients(id) ON DELETE CASCADE,
    treatment_id  INTEGER REFERENCES treatment_catalog(id) ON DELETE SET NULL,
    custom_name   TEXT NOT NULL DEFAULT '',
    tooth_codes   TEXT NOT NULL DEFAULT '',
    price_paisa   INTEGER NOT NULL DEFAULT 0,
    qty           INTEGER NOT NULL DEFAULT 1,
    notes         TEXT NOT NULL DEFAULT '',
    dentist_id    INTEGER REFERENCES dentists(id) ON DELETE SET NULL,
    treatment_date TEXT NOT NULL,
    created_by    INTEGER REFERENCES users(id) ON DELETE SET NULL,
    created_at    TEXT NOT NULL
);

-- -------------------------------------------------------------- medications
CREATE TABLE IF NOT EXISTS medication_catalog (
    id               INTEGER PRIMARY KEY AUTOINCREMENT,
    name             TEXT NOT NULL,
    generic_name     TEXT NOT NULL DEFAULT '',
    strength         TEXT NOT NULL DEFAULT '',
    form             TEXT NOT NULL DEFAULT 'Tablet',
    route            TEXT NOT NULL DEFAULT '',
    default_dosage   TEXT NOT NULL DEFAULT '',
    default_duration TEXT NOT NULL DEFAULT '',
    notes            TEXT NOT NULL DEFAULT '',
    active           INTEGER NOT NULL DEFAULT 1,
    created_at       TEXT NOT NULL,
    updated_at       TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS prescriptions (
    id               INTEGER PRIMARY KEY AUTOINCREMENT,
    patient_id       INTEGER NOT NULL REFERENCES patients(id) ON DELETE CASCADE,
    visit_id         INTEGER REFERENCES visits(id) ON DELETE SET NULL,
    dentist_id       INTEGER REFERENCES dentists(id) ON DELETE SET NULL,
    prescription_date TEXT NOT NULL,
    cc_text          TEXT NOT NULL DEFAULT '',
    oe_text          TEXT NOT NULL DEFAULT '',
    re_text          TEXT NOT NULL DEFAULT '',
    advice           TEXT NOT NULL DEFAULT '',
    follow_up        TEXT NOT NULL DEFAULT '',
    notes            TEXT NOT NULL DEFAULT '',
    created_by       INTEGER REFERENCES users(id) ON DELETE SET NULL,
    created_at       TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS prescription_items (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    prescription_id INTEGER NOT NULL REFERENCES prescriptions(id) ON DELETE CASCADE,
    medication_id INTEGER REFERENCES medication_catalog(id) ON DELETE SET NULL,
    medicine_name TEXT NOT NULL,
    generic_name  TEXT NOT NULL DEFAULT '',
    strength      TEXT NOT NULL DEFAULT '',
    form          TEXT NOT NULL DEFAULT 'Tablet',
    route         TEXT NOT NULL DEFAULT '',
    dosage        TEXT NOT NULL DEFAULT '',
    morning       TEXT NOT NULL DEFAULT '',
    noon          TEXT NOT NULL DEFAULT '',
    night         TEXT NOT NULL DEFAULT '',
    meal_relation TEXT NOT NULL DEFAULT '',
    frequency     TEXT NOT NULL DEFAULT '',
    duration      TEXT NOT NULL DEFAULT '',
    quantity      TEXT NOT NULL DEFAULT '',
    instruction   TEXT NOT NULL DEFAULT '',
    prn           TEXT NOT NULL DEFAULT '',
    notes         TEXT NOT NULL DEFAULT '',
    sort_order    INTEGER NOT NULL DEFAULT 0
);

-- -------------------------------------------------------------- appointments
CREATE TABLE IF NOT EXISTS appointments (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    patient_id  INTEGER NOT NULL REFERENCES patients(id) ON DELETE CASCADE,
    dentist_id  INTEGER REFERENCES dentists(id) ON DELETE SET NULL,
    appt_date   TEXT NOT NULL,
    appt_time   TEXT NOT NULL,
    duration_min INTEGER NOT NULL DEFAULT 30,
    reason      TEXT NOT NULL DEFAULT '',
    appt_type   TEXT NOT NULL DEFAULT 'General',
    notes       TEXT NOT NULL DEFAULT '',
    status      TEXT NOT NULL DEFAULT 'Scheduled',
    created_by  INTEGER REFERENCES users(id) ON DELETE SET NULL,
    created_at  TEXT NOT NULL,
    updated_at  TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS queue_entries (
    id             INTEGER PRIMARY KEY AUTOINCREMENT,
    appointment_id INTEGER REFERENCES appointments(id) ON DELETE SET NULL,
    patient_id     INTEGER NOT NULL REFERENCES patients(id) ON DELETE CASCADE,
    dentist_id     INTEGER REFERENCES dentists(id) ON DELETE SET NULL,
    queue_no       INTEGER NOT NULL,
    queue_date     TEXT NOT NULL,
    arrival_time   TEXT NOT NULL,
    priority       TEXT NOT NULL DEFAULT 'normal',
    status         TEXT NOT NULL DEFAULT 'waiting',
    called_at      TEXT,
    started_at     TEXT,
    completed_at   TEXT,
    notes          TEXT NOT NULL DEFAULT '',
    created_at     TEXT NOT NULL,
    updated_at     TEXT NOT NULL
);

-- ----------------------------------------------------------------- billing
CREATE TABLE IF NOT EXISTS invoices (
    id             INTEGER PRIMARY KEY AUTOINCREMENT,
    invoice_no     TEXT NOT NULL UNIQUE,
    patient_id     INTEGER NOT NULL REFERENCES patients(id) ON DELETE RESTRICT,
    visit_id       INTEGER REFERENCES visits(id) ON DELETE SET NULL,
    dentist_id     INTEGER REFERENCES dentists(id) ON DELETE SET NULL,
    invoice_date   TEXT NOT NULL,
    subtotal_paisa INTEGER NOT NULL DEFAULT 0,
    discount_paisa INTEGER NOT NULL DEFAULT 0,
    tax_paisa      INTEGER NOT NULL DEFAULT 0,
    total_paisa    INTEGER NOT NULL DEFAULT 0,
    paid_paisa     INTEGER NOT NULL DEFAULT 0,
    status         TEXT NOT NULL DEFAULT 'Due',
    notes          TEXT NOT NULL DEFAULT '',
    created_by     INTEGER REFERENCES users(id) ON DELETE SET NULL,
    created_at     TEXT NOT NULL,
    updated_at     TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS invoice_items (
    id                INTEGER PRIMARY KEY AUTOINCREMENT,
    invoice_id        INTEGER NOT NULL REFERENCES invoices(id) ON DELETE CASCADE,
    treatment_id      INTEGER REFERENCES treatment_catalog(id) ON DELETE SET NULL,
    description       TEXT NOT NULL,
    tooth_codes       TEXT NOT NULL DEFAULT '',
    qty               INTEGER NOT NULL DEFAULT 1,
    unit_price_paisa  INTEGER NOT NULL DEFAULT 0,
    line_total_paisa  INTEGER NOT NULL DEFAULT 0,
    sort_order        INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS payments (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    receipt_no   TEXT NOT NULL UNIQUE,
    invoice_id   INTEGER REFERENCES invoices(id) ON DELETE SET NULL,
    patient_id   INTEGER NOT NULL REFERENCES patients(id) ON DELETE RESTRICT,
    amount_paisa INTEGER NOT NULL,
    method       TEXT NOT NULL DEFAULT 'Cash',
    reference    TEXT NOT NULL DEFAULT '',
    payment_date TEXT NOT NULL,
    notes        TEXT NOT NULL DEFAULT '',
    reversed     INTEGER NOT NULL DEFAULT 0,
    reversed_by  INTEGER REFERENCES users(id) ON DELETE SET NULL,
    reversed_at  TEXT,
    created_by   INTEGER REFERENCES users(id) ON DELETE SET NULL,
    created_at   TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS payment_allocations (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    payment_id   INTEGER NOT NULL REFERENCES payments(id) ON DELETE CASCADE,
    invoice_id   INTEGER NOT NULL REFERENCES invoices(id) ON DELETE CASCADE,
    amount_paisa INTEGER NOT NULL
);

-- --------------------------------------------------------------- accounting
CREATE TABLE IF NOT EXISTS accounting_categories (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    kind        TEXT NOT NULL,
    name        TEXT NOT NULL,
    description TEXT NOT NULL DEFAULT '',
    active      INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE IF NOT EXISTS expenses (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    category_id  INTEGER REFERENCES accounting_categories(id) ON DELETE SET NULL,
    amount_paisa INTEGER NOT NULL,
    expense_date TEXT NOT NULL,
    method       TEXT NOT NULL DEFAULT 'Cash',
    reference    TEXT NOT NULL DEFAULT '',
    note         TEXT NOT NULL DEFAULT '',
    attachment_id INTEGER REFERENCES patient_attachments(id) ON DELETE SET NULL,
    created_by   INTEGER REFERENCES users(id) ON DELETE SET NULL,
    created_at   TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS income_records (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    category_id  INTEGER REFERENCES accounting_categories(id) ON DELETE SET NULL,
    amount_paisa INTEGER NOT NULL,
    income_date  TEXT NOT NULL,
    method       TEXT NOT NULL DEFAULT 'Cash',
    reference    TEXT NOT NULL DEFAULT '',
    note         TEXT NOT NULL DEFAULT '',
    created_by   INTEGER REFERENCES users(id) ON DELETE SET NULL,
    created_at   TEXT NOT NULL
);

-- --------------------------------------------------------------- inventory
CREATE TABLE IF NOT EXISTS suppliers (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    name       TEXT NOT NULL,
    phone      TEXT NOT NULL DEFAULT '',
    email      TEXT NOT NULL DEFAULT '',
    address    TEXT NOT NULL DEFAULT '',
    notes      TEXT NOT NULL DEFAULT '',
    active     INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS inventory_items (
    id                    INTEGER PRIMARY KEY AUTOINCREMENT,
    sku                   TEXT NOT NULL UNIQUE,
    name                  TEXT NOT NULL,
    category              TEXT NOT NULL DEFAULT 'General',
    supplier_id           INTEGER REFERENCES suppliers(id) ON DELETE SET NULL,
    unit                  TEXT NOT NULL DEFAULT 'pcs',
    purchase_price_paisa  INTEGER NOT NULL DEFAULT 0,
    internal_value_paisa  INTEGER NOT NULL DEFAULT 0,
    reorder_level         INTEGER NOT NULL DEFAULT 0,
    expiry_managed        INTEGER NOT NULL DEFAULT 0,
    notes                 TEXT NOT NULL DEFAULT '',
    active                INTEGER NOT NULL DEFAULT 1,
    created_at            TEXT NOT NULL,
    updated_at            TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS inventory_batches (
    id                   INTEGER PRIMARY KEY AUTOINCREMENT,
    item_id              INTEGER NOT NULL REFERENCES inventory_items(id) ON DELETE CASCADE,
    batch_no             TEXT NOT NULL DEFAULT '',
    expiry_date          TEXT,
    qty_received         INTEGER NOT NULL DEFAULT 0,
    qty_remaining        INTEGER NOT NULL DEFAULT 0,
    purchase_price_paisa INTEGER NOT NULL DEFAULT 0,
    supplier_id          INTEGER REFERENCES suppliers(id) ON DELETE SET NULL,
    purchase_date        TEXT,
    notes                TEXT NOT NULL DEFAULT '',
    created_at           TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS inventory_transactions (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    item_id       INTEGER NOT NULL REFERENCES inventory_items(id) ON DELETE CASCADE,
    batch_id      INTEGER REFERENCES inventory_batches(id) ON DELETE SET NULL,
    kind          TEXT NOT NULL,
    qty_delta     INTEGER NOT NULL,
    balance_after INTEGER NOT NULL,
    reason        TEXT NOT NULL DEFAULT '',
    ref_type      TEXT NOT NULL DEFAULT '',
    ref_id        INTEGER,
    performed_by  INTEGER REFERENCES users(id) ON DELETE SET NULL,
    created_at    TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS stock_adjustments (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    item_id      INTEGER NOT NULL REFERENCES inventory_items(id) ON DELETE CASCADE,
    batch_id     INTEGER REFERENCES inventory_batches(id) ON DELETE SET NULL,
    qty_before   INTEGER NOT NULL,
    qty_after    INTEGER NOT NULL,
    reason       TEXT NOT NULL,
    performed_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
    created_at   TEXT NOT NULL
);

-- ------------------------------------------------------ notifications/audit
CREATE TABLE IF NOT EXISTS notifications (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    severity     TEXT NOT NULL DEFAULT 'info',
    category     TEXT NOT NULL DEFAULT 'system',
    title        TEXT NOT NULL,
    message      TEXT NOT NULL DEFAULT '',
    entity_type  TEXT,
    entity_id    INTEGER,
    action_route TEXT,
    is_read      INTEGER NOT NULL DEFAULT 0,
    created_at   TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS audit_logs (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    timestamp   TEXT NOT NULL,
    user_id     INTEGER REFERENCES users(id) ON DELETE SET NULL,
    username    TEXT NOT NULL DEFAULT '',
    action      TEXT NOT NULL,
    entity_type TEXT NOT NULL DEFAULT '',
    entity_id   INTEGER,
    summary     TEXT NOT NULL DEFAULT '',
    before_json TEXT,
    after_json  TEXT,
    app_context TEXT NOT NULL DEFAULT ''
);

-- ----------------------------------------------------------- backup/restore
CREATE TABLE IF NOT EXISTS backup_records (
    id             INTEGER PRIMARY KEY AUTOINCREMENT,
    filename       TEXT NOT NULL,
    path           TEXT NOT NULL DEFAULT '',
    created_at     TEXT NOT NULL,
    size_bytes     INTEGER NOT NULL DEFAULT 0,
    schema_version INTEGER NOT NULL DEFAULT 1,
    app_version    TEXT NOT NULL DEFAULT '',
    kind           TEXT NOT NULL DEFAULT 'manual',
    status         TEXT NOT NULL DEFAULT 'ok',
    note           TEXT NOT NULL DEFAULT '',
    checksum       TEXT NOT NULL DEFAULT ''
);

CREATE TABLE IF NOT EXISTS restore_records (
    id                    INTEGER PRIMARY KEY AUTOINCREMENT,
    source_filename       TEXT NOT NULL,
    restored_at           TEXT NOT NULL,
    status                TEXT NOT NULL DEFAULT 'ok',
    note                  TEXT NOT NULL DEFAULT '',
    pre_restore_backup_id INTEGER REFERENCES backup_records(id) ON DELETE SET NULL,
    performed_by          INTEGER REFERENCES users(id) ON DELETE SET NULL
);

-- ----------------------------------------------------------------- settings
CREATE TABLE IF NOT EXISTS app_settings (
    key        TEXT PRIMARY KEY,
    value      TEXT NOT NULL DEFAULT '',
    updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS printer_profiles (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    name         TEXT NOT NULL,
    document_type TEXT NOT NULL DEFAULT 'prescription',
    printer_name TEXT NOT NULL DEFAULT '',
    paper_size   TEXT NOT NULL DEFAULT 'A4',
    margins_mm   TEXT NOT NULL DEFAULT '12,12,12,12',
    orientation  TEXT NOT NULL DEFAULT 'portrait',
    font_scale   REAL NOT NULL DEFAULT 1.0,
    header_mode  TEXT NOT NULL DEFAULT 'full',
    footer_mode  TEXT NOT NULL DEFAULT 'full',
    copies       INTEGER NOT NULL DEFAULT 1,
    is_default   INTEGER NOT NULL DEFAULT 0,
    thermal_opts TEXT NOT NULL DEFAULT '',
    created_at   TEXT NOT NULL,
    updated_at   TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS print_templates (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    document_type TEXT NOT NULL,
    name          TEXT NOT NULL,
    config_json   TEXT NOT NULL DEFAULT '{}',
    is_default    INTEGER NOT NULL DEFAULT 0,
    updated_at    TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS app_lock_state (
    id        INTEGER PRIMARY KEY CHECK (id = 1),
    locked    INTEGER NOT NULL DEFAULT 0,
    locked_at TEXT,
    locked_by INTEGER REFERENCES users(id) ON DELETE SET NULL
);

-- ------------------------------------------------------------------ indexes
CREATE INDEX IF NOT EXISTS idx_patients_code    ON patients(code);
CREATE INDEX IF NOT EXISTS idx_patients_name    ON patients(name);
CREATE INDEX IF NOT EXISTS idx_patients_phone   ON patients(phone);
CREATE INDEX IF NOT EXISTS idx_patients_emg     ON patients(emergency_phone);
CREATE INDEX IF NOT EXISTS idx_patients_regdate ON patients(reg_date);
CREATE INDEX IF NOT EXISTS idx_patients_dentist ON patients(dentist_id);
CREATE INDEX IF NOT EXISTS idx_visits_patient   ON visits(patient_id);
CREATE INDEX IF NOT EXISTS idx_visits_date      ON visits(visit_date);
CREATE INDEX IF NOT EXISTS idx_appt_date        ON appointments(appt_date);
CREATE INDEX IF NOT EXISTS idx_appt_patient     ON appointments(patient_id);
CREATE INDEX IF NOT EXISTS idx_appt_dentist     ON appointments(dentist_id);
CREATE INDEX IF NOT EXISTS idx_appt_status      ON appointments(status);
CREATE INDEX IF NOT EXISTS idx_queue_date       ON queue_entries(queue_date);
CREATE INDEX IF NOT EXISTS idx_queue_status     ON queue_entries(status);
CREATE INDEX IF NOT EXISTS idx_inv_no           ON invoices(invoice_no);
CREATE INDEX IF NOT EXISTS idx_inv_patient      ON invoices(patient_id);
CREATE INDEX IF NOT EXISTS idx_inv_date         ON invoices(invoice_date);
CREATE INDEX IF NOT EXISTS idx_inv_status       ON invoices(status);
CREATE INDEX IF NOT EXISTS idx_pay_date         ON payments(payment_date);
CREATE INDEX IF NOT EXISTS idx_pay_patient      ON payments(patient_id);
CREATE INDEX IF NOT EXISTS idx_pay_invoice      ON payments(invoice_id);
CREATE INDEX IF NOT EXISTS idx_rx_patient       ON prescriptions(patient_id);
CREATE INDEX IF NOT EXISTS idx_rx_date          ON prescriptions(prescription_date);
CREATE INDEX IF NOT EXISTS idx_treat_patient    ON treatment_records(patient_id);
CREATE INDEX IF NOT EXISTS idx_chart_patient    ON dental_chart_records(patient_id);
CREATE INDEX IF NOT EXISTS idx_chart_tooth      ON dental_chart_records(patient_id, tooth_code);
CREATE INDEX IF NOT EXISTS idx_attach_patient   ON patient_attachments(patient_id);
CREATE INDEX IF NOT EXISTS idx_audit_time       ON audit_logs(timestamp);
CREATE INDEX IF NOT EXISTS idx_audit_user       ON audit_logs(user_id);
CREATE INDEX IF NOT EXISTS idx_audit_action     ON audit_logs(action);
CREATE INDEX IF NOT EXISTS idx_notif_read       ON notifications(is_read);
CREATE INDEX IF NOT EXISTS idx_item_sku         ON inventory_items(sku);
CREATE INDEX IF NOT EXISTS idx_item_name        ON inventory_items(name);
CREATE INDEX IF NOT EXISTS idx_txn_item         ON inventory_transactions(item_id);
CREATE INDEX IF NOT EXISTS idx_batch_item       ON inventory_batches(item_id);
CREATE INDEX IF NOT EXISTS idx_batch_expiry     ON inventory_batches(expiry_date);
CREATE INDEX IF NOT EXISTS idx_exp_date         ON expenses(expense_date);
CREATE INDEX IF NOT EXISTS idx_inc_date         ON income_records(income_date);
CREATE INDEX IF NOT EXISTS idx_users_username   ON users(username);
