// Dentiva Pro — patient-side commands (native backend). Mirrors the fallback.

use rusqlite::params;
use serde_json::{json, Value};
use tauri::State;

use crate::ctx::AppState;
use crate::error::{CmdError, CmdResult};
use crate::util;

fn err(e: CmdError) -> String {
    e.to_string()
}

fn txn(conn: &rusqlite::Connection, f: impl FnOnce() -> CmdResult<()>) -> CmdResult<()> {
    conn.execute_batch("BEGIN IMMEDIATE")?;
    match f() {
        Ok(()) => {
            conn.execute_batch("COMMIT")?;
            Ok(())
        }
        Err(e) => {
            let _ = conn.execute_batch("ROLLBACK");
            Err(e)
        }
    }
}

fn next_code(
    conn: &rusqlite::Connection,
    prefix_key: &str,
    next_key: &str,
    pad_key: &str,
) -> String {
    let prefix = util::setting(conn, prefix_key, "");
    let next: i64 = util::setting(conn, next_key, "1")
        .parse()
        .unwrap_or(1)
        .max(1);
    let pad: usize = util::setting(conn, pad_key, "5")
        .parse()
        .unwrap_or(5)
        .max(1) as usize;
    let code = format!("{prefix}{:0>pad$}", next, pad = pad);
    let _ = conn.execute(
        "UPDATE app_settings SET value = ?1 WHERE key = ?2",
        params![(next + 1).to_string(), next_key],
    );
    code
}

fn add_days(iso: &str, d: i64) -> String {
    chrono::NaiveDate::parse_from_str(iso, "%Y-%m-%d")
        .map(|dt| {
            (dt + chrono::Duration::days(d))
                .format("%Y-%m-%d")
                .to_string()
        })
        .unwrap_or_else(|_| iso.to_string())
}

fn financial_view(state: &AppState) -> bool {
    state
        .optional_session()
        .map(|s| {
            s.permissions
                .iter()
                .any(|p| p == "*" || p == "invoices.view" || p == "payments.view")
        })
        .unwrap_or(false)
}

fn clinical_view(state: &AppState) -> bool {
    state
        .optional_session()
        .map(|s| {
            s.permissions
                .iter()
                .any(|p| p == "*" || p == "clinical.view")
        })
        .unwrap_or(false)
}

fn fnv1a(s: &str) -> String {
    let mut h: u32 = 0x811c9dc5;
    for b in s.bytes() {
        h ^= b as u32;
        h = h.wrapping_mul(0x01000193);
    }
    format!("{h:08x}")
}

// ------------------------------------------------------------ list/get
#[tauri::command]
pub fn patients_list(state: State<'_, AppState>, payload: Value) -> Result<Value, String> {
    (|| -> CmdResult<Value> {
        state.gate("patients_list")?;
        state.need("patients.view")?;
        let conn = state.conn.lock().unwrap();
        let range = payload.get("range").and_then(serde_json::Value::as_str).unwrap_or("today");
        let search = payload.get("search").and_then(serde_json::Value::as_str).unwrap_or("").trim().to_string();
        let sort = payload.get("sort").and_then(serde_json::Value::as_str).unwrap_or("newest");
        let dentist_id = payload.get("dentistId").and_then(serde_json::Value::as_i64).filter(|n| *n > 0);
        let status = payload.get("status").and_then(serde_json::Value::as_str).unwrap_or("");
        let page = payload.get("page").and_then(serde_json::Value::as_i64).unwrap_or(1).max(1);
        let page_size = payload.get("pageSize").and_then(serde_json::Value::as_i64).unwrap_or(25).clamp(5, 200);
        let today = util::today();
        let (from, to): (Option<String>, Option<String>) = if range == "custom" {
            (Some(payload.get("from").and_then(serde_json::Value::as_str).unwrap_or(&today).to_string()), Some(payload.get("to").and_then(serde_json::Value::as_str).unwrap_or(&today).to_string()))
        } else if range == "all" {
            (None, None)
        } else {
            let f = match range {
                "last7" => add_days(&today, -6),
                "last30" => add_days(&today, -29),
                "last90" => add_days(&today, -89),
                "last365" => add_days(&today, -364),
                _ => today.clone(),
            };
            (Some(f), Some(today.clone()))
        };
        let mut conds: Vec<String> = Vec::new();
        let mut args: Vec<String> = Vec::new();
        if let (Some(f), Some(t)) = (from, to) {
            conds.push(format!("p.reg_date BETWEEN ?{} AND ?{}", args.len() + 1, args.len() + 2));
            args.push(f);
            args.push(t);
        }
        if let Some(d) = dentist_id {
            conds.push(format!("p.dentist_id = {d}"));
        }
        if !status.is_empty() {
            conds.push(format!("p.status = ?{}", args.len() + 1));
            args.push(status.to_string());
        }
        if !search.is_empty() {
            conds.push(format!("(p.name LIKE ?{} OR p.code LIKE ?{} OR p.phone LIKE ?{} OR p.emergency_phone LIKE ?{} OR p.address LIKE ?{})",
                args.len() + 1, args.len() + 1, args.len() + 1, args.len() + 1, args.len() + 1));
            args.push(format!("%{search}%"));
        }
        let w = if conds.is_empty() { String::new() } else { format!("WHERE {}", conds.join(" AND ")) };
        let refs: Vec<&dyn rusqlite::ToSql> = args.iter().map(|v| v as &dyn rusqlite::ToSql).collect();
        let total: i64 = conn.query_row(&format!("SELECT COUNT(*) FROM patients p {w}"), &refs[..], |r| r.get(0)).unwrap_or(0);
        let order = match sort {
            "oldest" => "p.reg_date ASC, p.id ASC",
            "name" => "p.name COLLATE NOCASE ASC",
            "code" => "p.code ASC",
            "balance" => "balance DESC",
            _ => "p.reg_date DESC, p.id DESC",
        };
        let sql = format!("SELECT p.*, d.name AS dentist_name,
            COALESCE((SELECT SUM(total_paisa - paid_paisa) FROM invoices i WHERE i.patient_id = p.id AND i.status != 'Cancelled'), 0) AS balance,
            (SELECT MAX(appt_date) FROM appointments ap WHERE ap.patient_id = p.id AND ap.status IN ('Scheduled','Confirmed')) AS next_appt,
            (SELECT MAX(visit_date) FROM visits v WHERE v.patient_id = p.id) AS last_visit
            FROM patients p LEFT JOIN dentists d ON d.id = p.dentist_id
            {w} ORDER BY {order} LIMIT {page_size} OFFSET {}", (page - 1) * page_size);
        let rows = util::query_all(&conn, &sql, &refs)?;
        Ok(json!({ "rows": rows, "total": total, "page": page, "pageSize": page_size }))
    })()
    .map_err(err)
}

#[tauri::command]
pub fn patients_get(state: State<'_, AppState>, payload: Value) -> Result<Value, String> {
    (|| -> CmdResult<Value> {
        state.gate("patients_get")?;
        state.need("patients.view")?;
        let id = util::req_int(payload.get("id").unwrap_or(&Value::Null), "id", 1, i64::MAX)?;
        let conn = state.conn.lock().unwrap();
        let p = util::query_one(&conn, "SELECT p.*, d.name AS dentist_name FROM patients p LEFT JOIN dentists d ON d.id = p.dentist_id WHERE p.id = ?1", &[&id])?
            .ok_or_else(|| CmdError::new("NOT_FOUND", "Patient not found."))?;
        let tags: Vec<String> = util::query_all(&conn, "SELECT tag FROM patient_tags WHERE patient_id = ?1", &[&id])?
            .iter().filter_map(|t| t["tag"].as_str().map(ToString::to_string)).collect();
        let mut out = p.clone();
        out["tags"] = json!(tags);
        if !clinical_view(&state) {
            for k in ["complaint", "prev_problems", "medical_notes", "dental_notes", "allergies"] {
                out[k] = json!("");
            }
        }
        Ok(out)
    })()
    .map_err(err)
}

// ------------------------------------------------------------ create/update
fn duplicate_warnings(
    conn: &rusqlite::Connection,
    name: &str,
    phone: &str,
    dob: &str,
) -> Vec<String> {
    let mut warns = Vec::new();
    if !phone.is_empty() {
        let c: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM patients WHERE phone = ?1 OR emergency_phone = ?1",
                [phone],
                |r| r.get(0),
            )
            .unwrap_or(0);
        if c > 0 {
            warns.push(format!("{c} existing patient(s) share this phone number."));
        }
    }
    if !name.is_empty() {
        let c: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM patients WHERE LOWER(name) = LOWER(?1)",
                [name.trim()],
                |r| r.get(0),
            )
            .unwrap_or(0);
        if c > 0 {
            warns.push(format!("{c} existing patient(s) have the same name."));
        }
    }
    if !dob.is_empty() {
        let c: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM patients WHERE dob = ?1 AND LOWER(name) = LOWER(?2)",
                params![dob, name.trim()],
                |r| r.get(0),
            )
            .unwrap_or(0);
        if c > 0 {
            warns.push("An existing patient has the same name and date of birth.".to_string());
        }
    }
    warns
}

#[tauri::command]
pub fn patients_create(state: State<'_, AppState>, payload: Value) -> Result<Value, String> {
    (|| -> CmdResult<Value> {
        state.gate("patients_create")?;
        let me = state.need("patients.create")?;
        let name = util::req_text(payload.get("name").unwrap_or(&Value::Null), "Patient name", 160)?;
        let phone = util::opt_text(payload.get("phone").unwrap_or(&Value::Null), 32);
        let dob = payload.get("dob").and_then(serde_json::Value::as_str).unwrap_or("");
        if !dob.is_empty() {
            let b = dob.as_bytes();
            if b.len() != 10 || b[4] != b'-' || b[7] != b'-' {
                return Err(CmdError::new("VALIDATION", "Date of birth is invalid."));
            }
        }
        let conn = state.conn.lock().unwrap();
        let warnings = duplicate_warnings(&conn, &name, &phone, dob);
        let g = |k: &str, m: usize| util::opt_text(payload.get(k).unwrap_or(&Value::Null), m);
        let age = payload.get("age_years").and_then(serde_json::Value::as_i64);
        let dentist_id = util::opt_id(payload.get("dentist_id").unwrap_or(&Value::Null));
        let tags: Vec<String> = payload.get("tags").and_then(serde_json::Value::as_array).map(|a| a.iter().filter_map(|t| t.as_str().map(ToString::to_string)).collect()).unwrap_or_default();
        let status = { let s = g("status", 24); if s.is_empty() { "active".to_string() } else { s } };
        let mut new_id = 0i64;
        let mut code = String::new();
        txn(&conn, || {
            code = if payload.get("code").and_then(serde_json::Value::as_str).map(|s| !s.trim().is_empty()).unwrap_or(false) {
                util::req_text(payload.get("code").unwrap_or(&Value::Null), "Patient code", 32)?
            } else {
                next_code(&conn, "patient_code_prefix", "patient_code_next", "patient_code_pad")
            };
            let exists: i64 = conn.query_row("SELECT COUNT(*) FROM patients WHERE code = ?1", [&code], |r| r.get(0))?;
            if exists > 0 {
                return Err(CmdError::new("DUPLICATE", format!("Patient code {code} already exists.")));
            }
            conn.execute(
                "INSERT INTO patients (code, name, dob, age_years, gender, blood_group, address, phone, emergency_phone, emergency_contact, complaint, prev_problems, medical_notes, dental_notes, allergies, notes, reg_date, reg_user_id, dentist_id, referral_source, status, created_at, updated_at) VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?12,?13,?14,?15,?16,?17,?18,?19,?20,?21,?22,?22)",
                params![code, name, if dob.is_empty() { None } else { Some(dob) }, age, g("gender", 16), g("blood_group", 16), g("address", 500), phone,
                    g("emergency_phone", 32), g("emergency_contact", 120), g("complaint", 2000), g("prev_problems", 2000), g("medical_notes", 4000),
                    g("dental_notes", 4000), g("allergies", 2000), g("notes", 4000), util::today(), me.id, dentist_id, g("referral_source", 200), status, util::now_local()],
            )?;
            new_id = conn.last_insert_rowid();
            for t in tags.iter().take(20) {
                let tag: String = t.trim().chars().take(48).collect();
                if !tag.is_empty() {
                    conn.execute("INSERT INTO patient_tags (patient_id, tag) VALUES (?1, ?2)", params![new_id, tag])?;
                }
            }
            Ok(())
        })?;
        drop(conn);
        state.audit("patient.created", "patient", Some(new_id), &format!("Patient {name} ({code}) registered"), None, Some(json!({"name": name, "code": code}).to_string()));
        Ok(json!({ "id": new_id, "code": code, "warnings": warnings }))
    })()
    .map_err(err)
}

#[tauri::command]
pub fn patients_update(state: State<'_, AppState>, payload: Value) -> Result<Value, String> {
    (|| -> CmdResult<Value> {
        state.gate("patients_update")?;
        state.need("patients.edit")?;
        let id = util::req_int(payload.get("id").unwrap_or(&Value::Null), "id", 1, i64::MAX)?;
        let conn = state.conn.lock().unwrap();
        let before = util::query_one(&conn, "SELECT * FROM patients WHERE id = ?1", &[&id])?
            .ok_or_else(|| CmdError::new("NOT_FOUND", "Patient not found."))?;
        if let Some(code) = payload.get("code").and_then(serde_json::Value::as_str) {
            if code != before["code"].as_str().unwrap_or("") {
                let dup: i64 = conn.query_row("SELECT COUNT(*) FROM patients WHERE code = ?1 AND id != ?2", params![code, id], |r| r.get(0))?;
                if dup > 0 {
                    return Err(CmdError::new("DUPLICATE", "Patient code already exists."));
                }
            }
        }
        let fb = |k: &str| before[k].as_str().unwrap_or("").to_string();
        let g = |k: &str, m: usize| -> String {
            payload.get(k).and_then(serde_json::Value::as_str).unwrap_or(&fb(k)).trim().chars().take(m).collect()
        };
        let name = util::req_text(&json!(g("name", 160)), "Patient name", 160)?;
        let code = payload.get("code").and_then(serde_json::Value::as_str).unwrap_or(before["code"].as_str().unwrap_or("")).to_string();
        let dob: Option<String> = if payload.get("dob").is_some() { payload.get("dob").and_then(serde_json::Value::as_str).filter(|s| !s.is_empty()).map(ToString::to_string) } else { before["dob"].as_str().map(ToString::to_string) };
        let age: Option<i64> = if payload.get("age_years").is_some() { payload.get("age_years").and_then(serde_json::Value::as_i64) } else { before["age_years"].as_i64() };
        let dentist_id: Option<i64> = if payload.get("dentist_id").is_some() { util::opt_id(payload.get("dentist_id").unwrap_or(&Value::Null)) } else { before["dentist_id"].as_i64() };
        let tags: Option<Vec<String>> = payload.get("tags").and_then(serde_json::Value::as_array).map(|a| a.iter().filter_map(|t| t.as_str().map(ToString::to_string)).collect());
        txn(&conn, || {
            conn.execute(
                "UPDATE patients SET code = ?1, name = ?2, dob = ?3, age_years = ?4, gender = ?5, blood_group = ?6, address = ?7, phone = ?8, emergency_phone = ?9, emergency_contact = ?10, complaint = ?11, prev_problems = ?12, medical_notes = ?13, dental_notes = ?14, allergies = ?15, notes = ?16, dentist_id = ?17, referral_source = ?18, status = ?19, updated_at = ?20 WHERE id = ?21",
                params![code, name, dob, age, g("gender", 16), g("blood_group", 16), g("address", 500), g("phone", 32), g("emergency_phone", 32),
                    g("emergency_contact", 120), g("complaint", 2000), g("prev_problems", 2000), g("medical_notes", 4000), g("dental_notes", 4000),
                    g("allergies", 2000), g("notes", 4000), dentist_id, g("referral_source", 200), g("status", 24), util::now_local(), id],
            )?;
            if let Some(tl) = &tags {
                conn.execute("DELETE FROM patient_tags WHERE patient_id = ?1", [id])?;
                for t in tl.iter().take(20) {
                    let tag: String = t.trim().chars().take(48).collect();
                    if !tag.is_empty() {
                        conn.execute("INSERT INTO patient_tags (patient_id, tag) VALUES (?1, ?2)", params![id, tag])?;
                    }
                }
            }
            Ok(())
        })?;
        drop(conn);
        state.audit("patient.updated", "patient", Some(id), &format!("Patient #{id} updated"), Some(before.to_string()), Some(payload.to_string()));
        Ok(json!({ "id": id }))
    })()
    .map_err(err)
}

#[tauri::command]
pub fn patients_delete(state: State<'_, AppState>, payload: Value) -> Result<Value, String> {
    (|| -> CmdResult<Value> {
        state.gate("patients_delete")?;
        state.need("patients.delete")?;
        let id = util::req_int(payload.get("id").unwrap_or(&Value::Null), "id", 1, i64::MAX)?;
        let mode = payload.get("mode").and_then(serde_json::Value::as_str).unwrap_or("archive");
        let conn = state.conn.lock().unwrap();
        let p = util::query_one(&conn, "SELECT * FROM patients WHERE id = ?1", &[&id])?
            .ok_or_else(|| CmdError::new("NOT_FOUND", "Patient not found."))?;
        if mode == "archive" {
            conn.execute("UPDATE patients SET status = 'archived', archived = 1, updated_at = ?1 WHERE id = ?2", params![util::now_local(), id])?;
            drop(conn);
            state.audit("patient.archived", "patient", Some(id), &format!("Patient {} ({}) archived", p["name"].as_str().unwrap_or(""), p["code"].as_str().unwrap_or("")), None, None);
            return Ok(json!({ "id": id, "mode": mode }));
        }
        let inv: i64 = conn.query_row("SELECT COUNT(*) FROM invoices WHERE patient_id = ?1", [id], |r| r.get(0))?;
        let pay: i64 = conn.query_row("SELECT COUNT(*) FROM payments WHERE patient_id = ?1", [id], |r| r.get(0))?;
        if inv > 0 || pay > 0 {
            return Err(CmdError::new("HAS_FINANCIALS", format!("Cannot permanently delete: patient has {inv} invoice(s) and {pay} payment(s). Archive instead to preserve history.")));
        }
        let atts = util::query_all(&conn, "SELECT stored_name FROM patient_attachments WHERE patient_id = ?1", &[&id])?;
        txn(&conn, || {
            conn.execute("DELETE FROM patients WHERE id = ?1", [id])?;
            Ok(())
        })?;
        for t in &atts {
            let _ = std::fs::remove_file(state.paths.attachments_dir.join(format!("p{id}")).join(t["stored_name"].as_str().unwrap_or("")));
        }
        drop(conn);
        state.audit("patient.deleted", "patient", Some(id), &format!("Patient {} ({}) permanently deleted", p["name"].as_str().unwrap_or(""), p["code"].as_str().unwrap_or("")), Some(p.to_string()), None);
        Ok(json!({ "id": id, "mode": mode }))
    })()
    .map_err(err)
}

#[tauri::command]
pub fn patients_merge(state: State<'_, AppState>, payload: Value) -> Result<Value, String> {
    (|| -> CmdResult<Value> {
        state.gate("patients_merge")?;
        state.need("patients.merge")?;
        let master = util::req_int(
            payload.get("masterId").unwrap_or(&Value::Null),
            "masterId",
            1,
            i64::MAX,
        )?;
        let dup = util::req_int(
            payload.get("duplicateId").unwrap_or(&Value::Null),
            "duplicateId",
            1,
            i64::MAX,
        )?;
        if master == dup {
            return Err(CmdError::new(
                "VALIDATION",
                "Master and duplicate must differ.",
            ));
        }
        let conn = state.conn.lock().unwrap();
        let m = util::query_one(&conn, "SELECT * FROM patients WHERE id = ?1", &[&master])?;
        let d = util::query_one(&conn, "SELECT * FROM patients WHERE id = ?1", &[&dup])?;
        if m.is_none() || d.is_none() {
            return Err(CmdError::new("NOT_FOUND", "Patient not found."));
        }
        txn(&conn, || {
            for t in [
                "visits",
                "treatment_records",
                "prescriptions",
                "appointments",
                "queue_entries",
                "invoices",
                "payments",
                "patient_attachments",
                "patient_referrals",
                "patient_medical_notes",
                "patient_tags",
                "patient_extra_contacts",
                "dental_chart_records",
            ] {
                conn.execute(
                    &format!("UPDATE {t} SET patient_id = ?1 WHERE patient_id = ?2"),
                    params![master, dup],
                )?;
            }
            conn.execute("DELETE FROM patients WHERE id = ?1", [dup])?;
            Ok(())
        })?;
        drop(conn);
        state.audit(
            "patient.merged",
            "patient",
            Some(master),
            &format!("Patient #{dup} merged into #{master}"),
            Some(json!({"dupId": dup}).to_string()),
            Some(json!({"masterId": master}).to_string()),
        );
        Ok(json!({ "masterId": master }))
    })()
    .map_err(err)
}

// ------------------------------------------------------------ timeline/financials
#[tauri::command]
pub fn patient_timeline(state: State<'_, AppState>, payload: Value) -> Result<Value, String> {
    (|| -> CmdResult<Value> {
        state.gate("patient_timeline")?;
        state.need("patients.view")?;
        let id = util::req_int(payload.get("id").unwrap_or(&Value::Null), "id", 1, i64::MAX)?;
        let filter = payload.get("filter").and_then(serde_json::Value::as_str).unwrap_or("all");
        let conn = state.conn.lock().unwrap();
        let p = util::query_one(&conn, "SELECT * FROM patients WHERE id = ?1", &[&id])?
            .ok_or_else(|| CmdError::new("NOT_FOUND", "Patient not found."))?;
        let mut events: Vec<Value> = vec![json!({ "ts": format!("{}T00:00:00", p["reg_date"].as_str().unwrap_or("")), "type": "registration", "group": "record",
            "title": "Registered", "detail": format!("Patient code {}", p["code"].as_str().unwrap_or("")), "refId": id })];
        let clin = clinical_view(&state);
        let fin = financial_view(&state);
        if clin || filter == "all" {
            for v in util::query_all(&conn, "SELECT v.*, d.name AS dentist_name FROM visits v LEFT JOIN dentists d ON d.id = v.dentist_id WHERE patient_id = ?1 ORDER BY visit_date DESC, id DESC", &[&id])? {
                let diag = v["diagnosis"].as_str().unwrap_or("");
                let comp = v["complaint"].as_str().unwrap_or("");
                let label = if !diag.is_empty() { diag } else if !comp.is_empty() { comp } else { "Consultation" };
                events.push(json!({ "ts": format!("{}T12:00:00", v["visit_date"].as_str().unwrap_or("")), "type": "visit", "group": "clinical",
                    "title": format!("Visit — {label}"), "detail": v["dentist_name"].as_str().unwrap_or(""), "refId": v["id"] }));
            }
            for t in util::query_all(&conn, "SELECT tr.*, c.name AS cname FROM treatment_records tr LEFT JOIN treatment_catalog c ON c.id = tr.treatment_id WHERE tr.patient_id = ?1 ORDER BY treatment_date DESC", &[&id])? {
                let label = t["cname"].as_str().filter(|s| !s.is_empty()).unwrap_or_else(|| t["custom_name"].as_str().unwrap_or(""));
                events.push(json!({ "ts": format!("{}T12:00:00", t["treatment_date"].as_str().unwrap_or("")), "type": "treatment", "group": "clinical",
                    "title": format!("Treatment — {label}"), "detail": t["tooth_codes"].as_str().unwrap_or(""), "refId": t["id"] }));
            }
            for r in util::query_all(&conn, "SELECT * FROM prescriptions WHERE patient_id = ?1 ORDER BY prescription_date DESC", &[&id])? {
                events.push(json!({ "ts": format!("{}T12:00:00", r["prescription_date"].as_str().unwrap_or("")), "type": "prescription", "group": "prescriptions",
                    "title": "Prescription issued", "detail": "", "refId": r["id"] }));
            }
            for r in util::query_all(&conn, "SELECT * FROM patient_referrals WHERE patient_id = ?1 ORDER BY referral_date DESC", &[&id])? {
                let to = r["referred_to"].as_str().filter(|s| !s.is_empty()).unwrap_or_else(|| r["specialty"].as_str().unwrap_or(""));
                events.push(json!({ "ts": format!("{}T12:00:00", r["referral_date"].as_str().unwrap_or("")), "type": "referral", "group": "clinical",
                    "title": format!("Referral — {to}"), "detail": r["reason"].as_str().unwrap_or(""), "refId": r["id"] }));
            }
        }
        for ap in util::query_all(&conn, "SELECT * FROM appointments WHERE patient_id = ?1 ORDER BY appt_date DESC", &[&id])? {
            events.push(json!({ "ts": format!("{}T{}", ap["appt_date"].as_str().unwrap_or(""), ap["appt_time"].as_str().unwrap_or("")), "type": "appointment", "group": "appointments",
                "title": format!("Appointment — {}", ap["status"].as_str().unwrap_or("")), "detail": ap["reason"].as_str().unwrap_or(""), "refId": ap["id"] }));
        }
        if fin {
            for i in util::query_all(&conn, "SELECT * FROM invoices WHERE patient_id = ?1 ORDER BY invoice_date DESC", &[&id])? {
                events.push(json!({ "ts": format!("{}T12:00:00", i["invoice_date"].as_str().unwrap_or("")), "type": "invoice", "group": "financial",
                    "title": format!("Invoice {} — {}", i["invoice_no"].as_str().unwrap_or(""), i["status"].as_str().unwrap_or("")), "detail": "", "refId": i["id"] }));
            }
            for py in util::query_all(&conn, "SELECT * FROM payments WHERE patient_id = ?1 ORDER BY payment_date DESC", &[&id])? {
                events.push(json!({ "ts": format!("{}T12:00:00", py["payment_date"].as_str().unwrap_or("")), "type": "payment", "group": "financial",
                    "title": format!("Payment {} — {}", py["receipt_no"].as_str().unwrap_or(""), py["method"].as_str().unwrap_or("")), "detail": "", "refId": py["id"] }));
            }
        }
        for at in util::query_all(&conn, "SELECT * FROM patient_attachments WHERE patient_id = ?1 ORDER BY created_at DESC", &[&id])? {
            events.push(json!({ "ts": at["created_at"], "type": "attachment", "group": "documents",
                "title": format!("Attachment — {}", at["original_name"].as_str().unwrap_or("")), "detail": "", "refId": at["id"] }));
        }
        let groups: Vec<&str> = match filter {
            "clinical" => vec!["clinical", "prescriptions"],
            "financial" => vec!["financial"],
            "appointments" => vec!["appointments"],
            "documents" => vec!["documents"],
            "prescriptions" => vec!["prescriptions"],
            "treatment" => vec!["clinical"],
            _ => vec![],
        };
        let mut out: Vec<Value> = events.into_iter().filter(|e| {
            filter == "all" || groups.contains(&e["group"].as_str().unwrap_or("")) || (filter == "treatment" && e["type"].as_str().unwrap_or("") == "treatment")
        }).collect();
        out.sort_by(|x, y| y["ts"].as_str().unwrap_or("").cmp(x["ts"].as_str().unwrap_or("")));
        Ok(json!(out))
    })()
    .map_err(err)
}

#[tauri::command]
pub fn patient_financials(state: State<'_, AppState>, payload: Value) -> Result<Value, String> {
    (|| -> CmdResult<Value> {
        state.gate("patient_financials")?;
        state.need("invoices.view")?;
        let id = util::req_int(payload.get("id").unwrap_or(&Value::Null), "id", 1, i64::MAX)?;
        let conn = state.conn.lock().unwrap();
        let totals = util::query_one(&conn, "SELECT COALESCE(SUM(total_paisa),0) AS billed, COALESCE(SUM(paid_paisa),0) AS paid FROM invoices WHERE patient_id = ?1 AND status != 'Cancelled'", &[&id])?.unwrap_or(json!({ "billed": 0, "paid": 0 }));
        let invoices = util::query_all(&conn, "SELECT * FROM invoices WHERE patient_id = ?1 ORDER BY invoice_date DESC, id DESC", &[&id])?;
        let payments = util::query_all(&conn, "SELECT * FROM payments WHERE patient_id = ?1 ORDER BY payment_date DESC, id DESC", &[&id])?;
        let billed = totals["billed"].as_i64().unwrap_or(0);
        let paid = totals["paid"].as_i64().unwrap_or(0);
        Ok(json!({ "billed": billed, "paid": paid, "outstanding": billed - paid, "invoices": invoices, "payments": payments }))
    })()
    .map_err(err)
}

// ------------------------------------------------------------ mednotes
#[tauri::command]
pub fn mednotes_list(state: State<'_, AppState>, payload: Value) -> Result<Value, String> {
    (|| -> CmdResult<Value> {
        state.gate("mednotes_list")?;
        state.need("clinical.view")?;
        let id = util::req_int(payload.get("patientId").unwrap_or(&Value::Null), "patientId", 1, i64::MAX)?;
        let conn = state.conn.lock().unwrap();
        util::query_all(&conn, "SELECT n.*, u.full_name AS created_by_name FROM patient_medical_notes n LEFT JOIN users u ON u.id = n.created_by WHERE n.patient_id = ?1 ORDER BY n.created_at DESC", &[&id]).map(|v| json!(v))
    })()
    .map_err(err)
}

#[tauri::command]
pub fn mednotes_create(state: State<'_, AppState>, payload: Value) -> Result<Value, String> {
    (|| -> CmdResult<Value> {
        state.gate("mednotes_create")?;
        let me = state.need("clinical.create_visit")?;
        let patient_id = util::req_int(payload.get("patientId").unwrap_or(&Value::Null), "patientId", 1, i64::MAX)?;
        let note = util::req_text(payload.get("note").unwrap_or(&Value::Null), "note", 4000)?;
        let conn = state.conn.lock().unwrap();
        conn.execute("INSERT INTO patient_medical_notes (patient_id, note, created_by, created_at) VALUES (?1, ?2, ?3, ?4)", params![patient_id, note, me.id, util::now_local()])?;
        let id = conn.last_insert_rowid();
        drop(conn);
        state.audit("mednote.created", "mednote", Some(id), &format!("Medical note added for patient #{patient_id}"), None, None);
        Ok(json!({ "id": id }))
    })()
    .map_err(err)
}

// ------------------------------------------------------------ attachments
const ALLOWED_MIME: [&str; 10] = [
    "image/jpeg",
    "image/png",
    "image/webp",
    "image/gif",
    "image/bmp",
    "application/pdf",
    "image/tiff",
    "text/plain",
    "application/msword",
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
];

#[tauri::command]
pub fn attachments_list(state: State<'_, AppState>, payload: Value) -> Result<Value, String> {
    (|| -> CmdResult<Value> {
        state.gate("attachments_list")?;
        state.need("patients.view")?;
        let id = util::req_int(payload.get("patientId").unwrap_or(&Value::Null), "patientId", 1, i64::MAX)?;
        let conn = state.conn.lock().unwrap();
        util::query_all(&conn, "SELECT t.*, u.full_name AS uploaded_by_name FROM patient_attachments t LEFT JOIN users u ON u.id = t.uploaded_by WHERE t.patient_id = ?1 ORDER BY t.created_at DESC", &[&id]).map(|v| json!(v))
    })()
    .map_err(err)
}

#[tauri::command]
pub fn attachment_upload(state: State<'_, AppState>, payload: Value) -> Result<Value, String> {
    (|| -> CmdResult<Value> {
        state.gate("attachment_upload")?;
        state.need("patients.attachments")?;
        let patient_id = util::req_int(payload.get("patientId").unwrap_or(&Value::Null), "patientId", 1, i64::MAX)?;
        let original = util::safe_filename(&util::req_text(payload.get("name").unwrap_or(&Value::Null), "name", 160)?);
        let mime = payload.get("mime").and_then(serde_json::Value::as_str).unwrap_or("application/octet-stream");
        if !ALLOWED_MIME.contains(&mime) {
            return Err(CmdError::new("VALIDATION", format!("File type not supported: {mime}")));
        }
        let b64 = payload.get("base64").and_then(serde_json::Value::as_str).unwrap_or("");
        if b64.is_empty() {
            return Err(CmdError::new("VALIDATION", "Empty file."));
        }
        use base64::Engine;
        let bytes = base64::engine::general_purpose::STANDARD.decode(b64.as_bytes())?;
        if bytes.len() > 100 * 1024 * 1024 {
            return Err(CmdError::new("VALIDATION", "File exceeds 100 MB limit."));
        }
        let millis = chrono::Local::now().timestamp_millis();
        let rand_part: u32 = rand::random();
        let stored: String = format!("{millis:x}_{rand_part:x}_{original}").chars().take(150).collect();
        let dir = state.paths.attachments_dir.join(format!("p{patient_id}"));
        std::fs::create_dir_all(&dir)?;
        std::fs::write(dir.join(&stored), &bytes)?;
        let checksum = fnv1a(&b64.chars().take(200000).collect::<String>());
        let me = state.optional_session();
        let conn = state.conn.lock().unwrap();
        conn.execute("INSERT INTO patient_attachments (patient_id, original_name, stored_name, mime, size_bytes, sha256, category, note, uploaded_by, created_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10)",
            params![patient_id, original, stored, mime, bytes.len() as i64, checksum,
                { let c = util::opt_text(payload.get("category").unwrap_or(&Value::Null), 48); if c.is_empty() { "document".to_string() } else { c } },
                util::opt_text(payload.get("note").unwrap_or(&Value::Null), 1000), me.as_ref().map(|s| s.id), util::now_local()])?;
        let id = conn.last_insert_rowid();
        drop(conn);
        state.audit("attachment.uploaded", "attachment", Some(id), &format!("Attachment {original} uploaded for patient #{patient_id}"), None, Some(json!({"size": bytes.len()}).to_string()));
        Ok(json!({ "id": id }))
    })()
    .map_err(err)
}

#[tauri::command]
pub fn attachment_get(state: State<'_, AppState>, payload: Value) -> Result<Value, String> {
    (|| -> CmdResult<Value> {
        state.gate("attachment_get")?;
        state.need("patients.view")?;
        let id = util::req_int(payload.get("id").unwrap_or(&Value::Null), "id", 1, i64::MAX)?;
        let conn = state.conn.lock().unwrap();
        let att = util::query_one(&conn, "SELECT * FROM patient_attachments WHERE id = ?1", &[&id])?
            .ok_or_else(|| CmdError::new("NOT_FOUND", "Attachment not found."))?;
        let path = state.paths.attachments_dir.join(format!("p{}", att["patient_id"].as_i64().unwrap_or(0))).join(att["stored_name"].as_str().unwrap_or(""));
        drop(conn);
        use base64::Engine;
        match std::fs::read(&path) {
            Ok(bytes) => Ok(json!({ "name": att["original_name"], "mime": att["mime"], "base64": base64::engine::general_purpose::STANDARD.encode(&bytes) })),
            Err(_) => Err(CmdError::new("FILE_MISSING", "Attachment file is missing from storage. It may have been moved or deleted outside the app.")),
        }
    })()
    .map_err(err)
}

#[tauri::command]
pub fn attachment_delete(state: State<'_, AppState>, payload: Value) -> Result<Value, String> {
    (|| -> CmdResult<Value> {
        state.gate("attachment_delete")?;
        state.need("patients.attachments")?;
        let id = util::req_int(payload.get("id").unwrap_or(&Value::Null), "id", 1, i64::MAX)?;
        let conn = state.conn.lock().unwrap();
        let att = util::query_one(
            &conn,
            "SELECT * FROM patient_attachments WHERE id = ?1",
            &[&id],
        )?
        .ok_or_else(|| CmdError::new("NOT_FOUND", "Attachment not found."))?;
        conn.execute("DELETE FROM patient_attachments WHERE id = ?1", [id])?;
        let _ = std::fs::remove_file(
            state
                .paths
                .attachments_dir
                .join(format!("p{}", att["patient_id"].as_i64().unwrap_or(0)))
                .join(att["stored_name"].as_str().unwrap_or("")),
        );
        drop(conn);
        state.audit(
            "attachment.deleted",
            "attachment",
            Some(id),
            &format!(
                "Attachment {} deleted",
                att["original_name"].as_str().unwrap_or("")
            ),
            Some(att.to_string()),
            None,
        );
        Ok(json!({ "id": id }))
    })()
    .map_err(err)
}
