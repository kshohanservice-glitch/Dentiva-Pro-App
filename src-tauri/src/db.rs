// Dentiva Pro — SQLite open, schema install, system seed (native backend).
// Schema SQL is the single canonical file shared with the fallback backend.

use rusqlite::{params, Connection};
use std::path::PathBuf;

use crate::error::{CmdError, CmdResult};

pub const SCHEMA_SQL: &str = include_str!("../../../db/schema.sql");
pub const SCHEMA_VERSION: i64 = 1;
pub const APP_VERSION: &str = env!("CARGO_PKG_VERSION");

pub struct Paths {
    pub data_dir: PathBuf,
    pub db_path: PathBuf,
    pub attachments_dir: PathBuf,
    pub backups_dir: PathBuf,
    pub install_id_path: PathBuf,
    pub receipt_path: PathBuf,
}

pub fn resolve_paths(app_data: PathBuf) -> Paths {
    Paths {
        db_path: app_data.join("dentiva.db"),
        attachments_dir: app_data.join("attachments"),
        backups_dir: app_data.join("backups"),
        install_id_path: app_data.join("install.id"),
        receipt_path: app_data.join("activation.receipt"),
        data_dir: app_data,
    }
}

pub fn open_connection(db_path: &std::path::Path) -> CmdResult<Connection> {
    if let Some(parent) = db_path.parent() {
        std::fs::create_dir_all(parent)?;
    }
    let conn = Connection::open(db_path)
        .map_err(|e| CmdError::new("DB", format!("Could not open database: {e}")))?;
    conn.pragma_update(None, "journal_mode", "WAL")
        .map_err(|e| CmdError::new("DB", format!("Could not enable WAL mode: {e}")))?;
    conn.pragma_update(None, "foreign_keys", "ON")
        .map_err(|e| CmdError::new("DB", format!("Could not enforce foreign keys: {e}")))?;
    conn.pragma_update(None, "synchronous", "FULL")?;
    Ok(conn)
}

/// Install schema + system seed on a fresh database. Never touches existing data.
pub fn ensure_schema(conn: &Connection) -> CmdResult<bool> {
    let has_meta: bool = conn
        .query_row(
            "SELECT COUNT(*) FROM sqlite_master WHERE type = 'table' AND name = 'meta'",
            [],
            |r| r.get::<_, i64>(0),
        )
        .map(|n| n > 0)?;
    if has_meta {
        return Ok(false);
    }
    conn.execute_batch(SCHEMA_SQL)?;
    seed_fresh(conn)?;
    Ok(true)
}

pub fn permission_catalog() -> Vec<(&'static str, &'static str, &'static str)> {
    vec![
        ("patients.view", "View patients", "Patients"),
        ("patients.create", "Create patients", "Patients"),
        ("patients.edit", "Edit patients", "Patients"),
        ("patients.delete", "Delete / archive patients", "Patients"),
        ("patients.attachments", "Manage attachments", "Patients"),
        ("patients.merge", "Merge duplicate patients", "Patients"),
        ("patients.export", "Export patient data", "Patients"),
        ("clinical.view", "View clinical data", "Clinical"),
        ("clinical.create_visit", "Create visits", "Clinical"),
        ("clinical.edit_visit", "Edit visits", "Clinical"),
        ("clinical.delete_visit", "Delete visits", "Clinical"),
        ("clinical.chart", "Manage dental chart", "Clinical"),
        ("clinical.referral", "Manage referrals", "Clinical"),
        (
            "treatments.manage",
            "Manage treatment catalog",
            "Treatments",
        ),
        (
            "prescriptions.create",
            "Create prescriptions",
            "Prescriptions",
        ),
        ("prescriptions.edit", "Edit prescriptions", "Prescriptions"),
        (
            "prescriptions.print",
            "Print prescriptions",
            "Prescriptions",
        ),
        ("appointments.view", "View appointments", "Appointments"),
        ("appointments.manage", "Manage appointments", "Appointments"),
        ("queue.manage", "Manage queue", "Queue"),
        ("invoices.view", "View invoices", "Billing"),
        ("invoices.create", "Create invoices", "Billing"),
        ("invoices.edit", "Edit invoices", "Billing"),
        ("invoices.delete", "Delete invoices", "Billing"),
        ("invoices.print", "Print invoices", "Billing"),
        ("payments.view", "View payments", "Billing"),
        ("payments.record", "Record payments", "Billing"),
        ("payments.reverse", "Reverse payments", "Billing"),
        ("inventory.view", "View inventory", "Inventory"),
        ("inventory.manage", "Manage inventory", "Inventory"),
        ("accounting.view", "View accounting", "Accounting"),
        ("accounting.manage", "Manage accounting", "Accounting"),
        ("staff.view", "View staff", "Staff"),
        ("staff.manage", "Manage staff", "Staff"),
        ("users.manage", "Manage users", "Administration"),
        (
            "roles.manage",
            "Manage roles & permissions",
            "Administration",
        ),
        ("settings.manage", "Manage settings", "Administration"),
        (
            "printers.manage",
            "Manage printer profiles",
            "Administration",
        ),
        ("backup.run", "Run backups", "Administration"),
        ("backup.restore", "Restore backups", "Administration"),
        ("audit.view", "View audit log", "Administration"),
        ("reports.view", "View reports", "Reports"),
        ("reports.financial", "View financial reports", "Reports"),
        (
            "data.danger",
            "Destructive data operations",
            "Administration",
        ),
    ]
}

fn default_grants(role: &str) -> Vec<&'static str> {
    match role {
        "Administrator" => permission_catalog()
            .into_iter()
            .map(|(c, _, _)| c)
            .filter(|c| *c != "data.danger")
            .collect(),
        "Dentist" => vec![
            "patients.view",
            "patients.create",
            "patients.edit",
            "patients.attachments",
            "clinical.view",
            "clinical.create_visit",
            "clinical.edit_visit",
            "clinical.chart",
            "clinical.referral",
            "treatments.manage",
            "prescriptions.create",
            "prescriptions.edit",
            "prescriptions.print",
            "appointments.view",
            "reports.view",
        ],
        "Receptionist" => vec![
            "patients.view",
            "patients.create",
            "patients.edit",
            "patients.attachments",
            "appointments.view",
            "appointments.manage",
            "queue.manage",
            "reports.view",
        ],
        "Assistant" => vec![
            "patients.view",
            "clinical.view",
            "clinical.create_visit",
            "clinical.chart",
            "appointments.view",
            "queue.manage",
        ],
        "Accountant" => vec![
            "patients.view",
            "invoices.view",
            "invoices.create",
            "invoices.edit",
            "invoices.print",
            "payments.view",
            "payments.record",
            "accounting.view",
            "accounting.manage",
            "reports.view",
            "reports.financial",
            "audit.view",
        ],
        "Inventory Manager" => vec!["inventory.view", "inventory.manage", "reports.view"],
        _ => vec![],
    }
}

fn seed_fresh(conn: &Connection) -> CmdResult<()> {
    let now = crate::util::now_local();
    conn.execute(
        "INSERT INTO meta (key, value) VALUES ('schema_version', ?1), ('app_version', ?2), ('activated', '0'), ('setup_complete', '0')",
        params![SCHEMA_VERSION.to_string(), APP_VERSION],
    )?;
    conn.execute(
        "INSERT INTO clinic (id, name, created_at, updated_at) VALUES (1, 'Dental Care', ?1, ?1)",
        params![now],
    )?;
    conn.execute("INSERT INTO app_lock_state (id, locked) VALUES (1, 0)", ())?;
    for (code, name, module) in permission_catalog() {
        conn.execute(
            "INSERT INTO permissions (code, name, module) VALUES (?1, ?2, ?3)",
            params![code, name, module],
        )?;
    }
    for role in [
        "Owner",
        "Administrator",
        "Dentist",
        "Receptionist",
        "Assistant",
        "Accountant",
        "Inventory Manager",
    ] {
        conn.execute(
            "INSERT INTO roles (name, description, system_role, created_at, updated_at) VALUES (?1, ?2, 1, ?3, ?3)",
            params![role, format!("Built-in {role} role"), now],
        )?;
        let role_id = conn.last_insert_rowid();
        let grants: Vec<&str> = if role == "Owner" {
            permission_catalog()
                .into_iter()
                .map(|(c, _, _)| c)
                .collect()
        } else {
            default_grants(role)
        };
        for g in grants {
            conn.execute(
                "INSERT OR IGNORE INTO role_permissions (role_id, permission_code) VALUES (?1, ?2)",
                params![role_id, g],
            )?;
        }
    }
    let teeth = [
        ("healthy", "Healthy", "#10b981", 0),
        ("caries", "Caries", "#ef4444", 1),
        ("restoration", "Restoration / Filling", "#3b82f6", 2),
        ("missing", "Missing", "#64748b", 3),
        ("extraction", "Extraction advised/done", "#f97316", 4),
        ("impacted", "Impacted", "#a855f7", 5),
        ("root_canal", "Root canal treated", "#0ea5e9", 6),
        ("crown", "Crown", "#eab308", 7),
        ("bridge", "Bridge", "#ca8a04", 8),
        ("fracture", "Fracture", "#dc2626", 9),
        ("mobility", "Mobility", "#fb7185", 10),
        ("perio", "Periodontal issue", "#f43f5e", 11),
        ("watch", "Watch / review", "#8b5cf6", 12),
    ];
    for (code, name, color, sort) in teeth {
        conn.execute(
            "INSERT INTO tooth_condition_types (code, name, color, sort) VALUES (?1, ?2, ?3, ?4)",
            params![code, name, color, sort],
        )?;
    }
    let cats = [
        ("income", "Consultation", "Consultation fees"),
        ("income", "Treatment", "Treatment income"),
        ("income", "Other income", "Miscellaneous income"),
        ("expense", "Clinic rent", ""),
        ("expense", "Electricity", ""),
        ("expense", "Internet", ""),
        ("expense", "Accessories", ""),
        ("expense", "Dental supplies", ""),
        ("expense", "Staff salary", ""),
        ("expense", "Maintenance", ""),
        ("expense", "Transport", ""),
        ("expense", "Marketing", ""),
        ("expense", "Equipment", ""),
        ("expense", "Miscellaneous", ""),
    ];
    for (kind, name, desc) in cats {
        conn.execute("INSERT INTO accounting_categories (kind, name, description, active) VALUES (?1, ?2, ?3, 1)", params![kind, name, desc])?;
    }
    let settings = [
        ("currency", "BDT"),
        ("date_format", "DD MMM YYYY"),
        ("time_format", "12h"),
        ("default_paper_size", "A4"),
        ("patient_code_prefix", "DP-"),
        ("patient_code_next", "1"),
        ("patient_code_pad", "5"),
        ("invoice_prefix", "INV-"),
        ("invoice_next", "1"),
        ("receipt_prefix", "RCP-"),
        ("receipt_next", "1"),
        ("auto_lock_minutes", "15"),
        ("allow_never_lock", "0"),
        ("session_timeout_minutes", "480"),
        ("backup_location", ""),
        ("auto_backup_days", "7"),
        ("last_auto_backup", ""),
        ("prescription_show_code", "1"),
        ("invoice_show_signature", "0"),
        ("invoice_tax_percent", "0"),
        ("clinic_message_default", "Take care of your smile. Follow the prescribed advice and visit for follow-up as advised."),
    ];
    for (k, v) in settings {
        conn.execute(
            "INSERT INTO app_settings (key, value, updated_at) VALUES (?1, ?2, ?3)",
            params![k, v, now],
        )?;
    }
    let profiles = [
        (
            "Prescription — A4",
            "prescription",
            "A4",
            "12,12,14,12",
            "portrait",
            1.0,
            1,
        ),
        (
            "Prescription — A5",
            "prescription",
            "A5",
            "10,10,12,10",
            "portrait",
            0.92,
            0,
        ),
        (
            "Invoice — A5",
            "invoice",
            "A5",
            "10,10,10,10",
            "portrait",
            1.0,
            1,
        ),
        (
            "Invoice — Thermal 80mm",
            "invoice",
            "THERMAL_80",
            "4,4,4,4",
            "portrait",
            0.95,
            0,
        ),
        (
            "Patient Summary — A4",
            "summary",
            "A4",
            "12,12,14,12",
            "portrait",
            1.0,
            1,
        ),
        (
            "Report — A4",
            "report",
            "A4",
            "12,12,14,12",
            "portrait",
            1.0,
            1,
        ),
    ];
    // NOTE: names/margins/scales above must stay identical to DEFAULT_PRINTER_PROFILES.
    for (name, doc, paper, margins, orient, scale, def) in profiles {
        conn.execute(
            "INSERT INTO printer_profiles (name, document_type, paper_size, margins_mm, orientation, font_scale, is_default, created_at, updated_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?8)",
            params![name, doc, paper, margins, orient, scale, def, now],
        )?;
    }
    conn.execute("INSERT INTO print_templates (document_type, name, config_json, is_default, updated_at) VALUES ('prescription', 'Default clinical', '{}', 1, ?1)", params![now])?;
    conn.execute("INSERT INTO print_templates (document_type, name, config_json, is_default, updated_at) VALUES ('invoice', 'Default invoice', '{}', 1, ?1)", params![now])?;
    Ok(())
}
