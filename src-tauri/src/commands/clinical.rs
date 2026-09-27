// Dentiva Pro — clinical commands (native backend). Mirrors the fallback.

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

// ------------------------------------------------------------ visits
#[tauri::command]
pub fn visits_list(state: State<'_, AppState>, payload: Value) -> Result<Value, String> {
    (|| -> CmdResult<Value> {
        state.gate("visits_list")?;
        state.need("clinical.view")?;
        let id = util::req_int(payload.get("patientId").unwrap_or(&Value::Null), "patientId", 1, i64::MAX)?;
        let conn = state.conn.lock().unwrap();
        util::query_all(&conn, "SELECT v.*, d.name AS dentist_name, u.full_name AS created_by_name FROM visits v LEFT JOIN dentists d ON d.id = v.dentist_id LEFT JOIN users u ON u.id = v.created_by WHERE v.patient_id = ?1 ORDER BY v.visit_date DESC, v.id DESC", &[&id]).map(|v| json!(v))
    })()
    .map_err(err)
}

#[tauri::command]
pub fn visits_create(state: State<'_, AppState>, payload: Value) -> Result<Value, String> {
    (|| -> CmdResult<Value> {
        state.gate("visits_create")?;
        let me = state.need("clinical.create_visit")?;
        let patient_id = util::req_int(payload.get("patientId").unwrap_or(&Value::Null), "patientId", 1, i64::MAX)?;
        let visit_date = util::req_date(payload.get("visitDate").unwrap_or(&json!(util::today())), "visitDate")?;
        let follow_up = payload.get("followUpDate").and_then(serde_json::Value::as_str).filter(|s| !s.is_empty()).map(ToString::to_string);
        let conn = state.conn.lock().unwrap();
        let g = |k: &str| util::opt_text(payload.get(k).unwrap_or(&Value::Null), 4000);
        conn.execute("INSERT INTO visits (patient_id, visit_date, dentist_id, complaint, history, examination, diagnosis, procedure_notes, advice, follow_up_date, referral_note, notes, created_by, created_at, updated_at) VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?12,?13,?14,?14)",
            params![patient_id, visit_date, util::opt_id(payload.get("dentistId").unwrap_or(&Value::Null)), g("complaint"), g("history"), g("examination"),
                g("diagnosis"), g("procedure_notes"), g("advice"), follow_up.clone(), g("referral_note"), g("notes"), me.id, util::now_local()])?;
        let id = conn.last_insert_rowid();
        drop(conn);
        state.audit("visit.created", "visit", Some(id), &format!("Visit recorded for patient #{patient_id}"), None, Some(json!({"patientId": patient_id, "visitDate": visit_date}).to_string()));
        if let Some(f) = follow_up {
            state.notify("info", "appointment", "Follow-up scheduled", &format!("Patient #{patient_id} follow-up on {f}."), Some("patient"), Some(patient_id), Some(&format!("patients/{patient_id}")));
        }
        Ok(json!({ "id": id }))
    })()
    .map_err(err)
}

#[tauri::command]
pub fn visits_update(state: State<'_, AppState>, payload: Value) -> Result<Value, String> {
    (|| -> CmdResult<Value> {
        state.gate("visits_update")?;
        state.need("clinical.edit_visit")?;
        let id = util::req_int(payload.get("id").unwrap_or(&Value::Null), "id", 1, i64::MAX)?;
        let conn = state.conn.lock().unwrap();
        let before = util::query_one(&conn, "SELECT * FROM visits WHERE id = ?1", &[&id])?
            .ok_or_else(|| CmdError::new("NOT_FOUND", "Visit not found."))?;
        let fb = |k: &str| before[k].as_str().unwrap_or("").to_string();
        let g = |k: &str| -> String { payload.get(k).and_then(serde_json::Value::as_str).unwrap_or(&fb(k)).chars().take(4000).collect::<String>().trim().to_string() };
        let visit_date = if payload.get("visitDate").is_some() { util::req_date(payload.get("visitDate").unwrap_or(&Value::Null), "visitDate")? } else { fb("visit_date") };
        let dentist_id: Option<i64> = if payload.get("dentistId").is_some() { util::opt_id(payload.get("dentistId").unwrap_or(&Value::Null)) } else { before["dentist_id"].as_i64() };
        let follow_up: Option<String> = if payload.get("followUpDate").is_some() { payload.get("followUpDate").and_then(serde_json::Value::as_str).filter(|s| !s.is_empty()).map(ToString::to_string) } else { before["follow_up_date"].as_str().map(ToString::to_string) };
        conn.execute("UPDATE visits SET visit_date = ?1, dentist_id = ?2, complaint = ?3, history = ?4, examination = ?5, diagnosis = ?6, procedure_notes = ?7, advice = ?8, follow_up_date = ?9, referral_note = ?10, notes = ?11, updated_at = ?12 WHERE id = ?13",
            params![visit_date, dentist_id, g("complaint"), g("history"), g("examination"), g("diagnosis"), g("procedure_notes"), g("advice"), follow_up, g("referral_note"), g("notes"), util::now_local(), id])?;
        drop(conn);
        state.audit("visit.updated", "visit", Some(id), &format!("Visit #{id} updated"), Some(before.to_string()), Some(payload.to_string()));
        Ok(json!({ "id": id }))
    })()
    .map_err(err)
}

#[tauri::command]
pub fn visits_delete(state: State<'_, AppState>, payload: Value) -> Result<Value, String> {
    (|| -> CmdResult<Value> {
        state.gate("visits_delete")?;
        state.need("clinical.delete_visit")?;
        let id = util::req_int(payload.get("id").unwrap_or(&Value::Null), "id", 1, i64::MAX)?;
        let conn = state.conn.lock().unwrap();
        let before = util::query_one(&conn, "SELECT * FROM visits WHERE id = ?1", &[&id])?
            .ok_or_else(|| CmdError::new("NOT_FOUND", "Visit not found."))?;
        conn.execute("DELETE FROM visits WHERE id = ?1", [id])?;
        drop(conn);
        state.audit(
            "visit.deleted",
            "visit",
            Some(id),
            &format!("Visit #{id} deleted"),
            Some(before.to_string()),
            None,
        );
        Ok(json!({ "id": id }))
    })()
    .map_err(err)
}

// ------------------------------------------------------------ dental chart
const ADULT_TEETH: [&str; 32] = [
    "18", "17", "16", "15", "14", "13", "12", "11", "21", "22", "23", "24", "25", "26", "27", "28",
    "48", "47", "46", "45", "44", "43", "42", "41", "31", "32", "33", "34", "35", "36", "37", "38",
];
const CHILD_TEETH: [&str; 20] = [
    "55", "54", "53", "52", "51", "61", "62", "63", "64", "65", "85", "84", "83", "82", "81", "71",
    "72", "73", "74", "75",
];

#[tauri::command]
pub fn chart_get(state: State<'_, AppState>, payload: Value) -> Result<Value, String> {
    (|| -> CmdResult<Value> {
        state.gate("chart_get")?;
        state.need("clinical.view")?;
        let patient_id = util::req_int(payload.get("patientId").unwrap_or(&Value::Null), "patientId", 1, i64::MAX)?;
        let conn = state.conn.lock().unwrap();
        let recs = util::query_all(&conn, "SELECT * FROM dental_chart_records WHERE patient_id = ?1 ORDER BY recorded_at DESC, id DESC", &[&patient_id])?;
        let mut latest = serde_json::Map::new();
        for r in &recs {
            if let Some(code) = r["tooth_code"].as_str() {
                latest.entry(code.to_string()).or_insert_with(|| r.clone());
            }
        }
        let types = util::query_all(&conn, "SELECT * FROM tooth_condition_types ORDER BY sort", params!())?;
        Ok(json!({ "latest": latest, "history": recs, "types": types }))
    })()
    .map_err(err)
}

#[tauri::command]
pub fn chart_set(state: State<'_, AppState>, payload: Value) -> Result<Value, String> {
    (|| -> CmdResult<Value> {
        state.gate("chart_set")?;
        let me = state.need("clinical.chart")?;
        let patient_id = util::req_int(payload.get("patientId").unwrap_or(&Value::Null), "patientId", 1, i64::MAX)?;
        let teeth: Vec<String> = if let Some(arr) = payload.get("teeth").and_then(serde_json::Value::as_array) {
            arr.iter().filter_map(|t| t.as_str().map(ToString::to_string)).collect()
        } else {
            vec![payload.get("tooth").and_then(serde_json::Value::as_str).unwrap_or("").to_string()]
        };
        let condition = util::req_text(payload.get("condition").unwrap_or(&Value::Null), "condition", 32)?;
        for t in &teeth {
            if !ADULT_TEETH.contains(&t.as_str()) && !CHILD_TEETH.contains(&t.as_str()) {
                return Err(CmdError::new("VALIDATION", format!("Invalid tooth code: {t}")));
            }
        }
        let conn = state.conn.lock().unwrap();
        let type_ok: i64 = conn.query_row("SELECT COUNT(*) FROM tooth_condition_types WHERE code = ?1", [&condition], |r| r.get(0))?;
        if type_ok == 0 {
            return Err(CmdError::new("VALIDATION", "Unknown tooth condition."));
        }
        let notes = util::opt_text(payload.get("notes").unwrap_or(&Value::Null), 1000);
        let treatment_id = util::opt_id(payload.get("treatmentId").unwrap_or(&Value::Null));
        let dentist_id = util::opt_id(payload.get("dentistId").unwrap_or(&Value::Null));
        txn(&conn, || {
            for t in &teeth {
                conn.execute("INSERT INTO dental_chart_records (patient_id, tooth_code, condition_code, notes, treatment_id, dentist_id, recorded_by, recorded_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)",
                    params![patient_id, t, condition, notes, treatment_id, dentist_id, me.id, util::now_local()])?;
            }
            Ok(())
        })?;
        drop(conn);
        state.audit("chart.updated", "patient", Some(patient_id), &format!("Dental chart updated ({} → {condition})", teeth.join(", ")), None, Some(json!({"teeth": teeth, "condition": condition}).to_string()));
        Ok(json!({ "teeth": teeth }))
    })()
    .map_err(err)
}

// ------------------------------------------------------------ treatment catalog
#[tauri::command]
pub fn treatments_list(state: State<'_, AppState>, payload: Value) -> Result<Value, String> {
    (|| -> CmdResult<Value> {
        state.gate("treatments_list")?;
        let conn = state.conn.lock().unwrap();
        let q = payload
            .get("search")
            .and_then(serde_json::Value::as_str)
            .unwrap_or("")
            .trim()
            .to_string();
        let active_only = payload
            .get("activeOnly")
            .and_then(serde_json::Value::as_bool)
            .unwrap_or(true);
        let mut sql = String::from("SELECT * FROM treatment_catalog");
        let mut conds: Vec<String> = Vec::new();
        let mut args: Vec<String> = Vec::new();
        if active_only {
            conds.push("active = 1".to_string());
        }
        if !q.is_empty() {
            conds.push(format!(
                "(name LIKE ?{} OR code LIKE ?{} OR category LIKE ?{})",
                args.len() + 1,
                args.len() + 1,
                args.len() + 1
            ));
            args.push(format!("%{q}%"));
        }
        if !conds.is_empty() {
            sql.push_str(&format!(" WHERE {}", conds.join(" AND ")));
        }
        sql.push_str(" ORDER BY category, name");
        let refs: Vec<&dyn rusqlite::ToSql> =
            args.iter().map(|v| v as &dyn rusqlite::ToSql).collect();
        util::query_all(&conn, &sql, &refs).map(|v| json!(v))
    })()
    .map_err(err)
}

#[tauri::command]
pub fn treatments_save(state: State<'_, AppState>, payload: Value) -> Result<Value, String> {
    (|| -> CmdResult<Value> {
        state.gate("treatments_save")?;
        state.need("treatments.manage")?;
        let name = util::req_text(payload.get("name").unwrap_or(&Value::Null), "Treatment name", 160)?;
        let code = util::req_text(payload.get("code").unwrap_or(&Value::Null), "Treatment code", 32)?;
        let price = util::req_money(payload.get("default_price_paisa").unwrap_or(&Value::Null), "price")?;
        let duration = util::req_int(payload.get("duration_min").unwrap_or(&json!(30)), "duration", 1, 1440)?;
        let conn = state.conn.lock().unwrap();
        let category = { let c = util::opt_text(payload.get("category").unwrap_or(&Value::Null), 80); if c.is_empty() { "General".to_string() } else { c } };
        let notes = util::opt_text(payload.get("notes").unwrap_or(&Value::Null), 2000);
        if let Some(id) = util::opt_id(payload.get("id").unwrap_or(&Value::Null)) {
            let dup: i64 = conn.query_row("SELECT COUNT(*) FROM treatment_catalog WHERE code = ?1 AND id != ?2", params![code, id], |r| r.get(0))?;
            if dup > 0 {
                return Err(CmdError::new("DUPLICATE", "Treatment code already exists."));
            }
            let active = if payload.get("active").and_then(serde_json::Value::as_bool).unwrap_or(true) { 1 } else { 0 };
            conn.execute("UPDATE treatment_catalog SET code = ?1, name = ?2, category = ?3, default_price_paisa = ?4, duration_min = ?5, notes = ?6, active = ?7, updated_at = ?8 WHERE id = ?9",
                params![code, name, category, price, duration, notes, active, util::now_local(), id])?;
            drop(conn);
            state.audit("treatment.updated", "treatment", Some(id), &format!("Treatment {name} updated"), None, Some(payload.to_string()));
            return Ok(json!({ "id": id }));
        }
        let dup: i64 = conn.query_row("SELECT COUNT(*) FROM treatment_catalog WHERE code = ?1", [&code], |r| r.get(0))?;
        if dup > 0 {
            return Err(CmdError::new("DUPLICATE", "Treatment code already exists."));
        }
        conn.execute("INSERT INTO treatment_catalog (code, name, category, default_price_paisa, duration_min, notes, active, created_at, updated_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6, 1, ?7, ?7)",
            params![code, name, category, price, duration, notes, util::now_local()])?;
        let id = conn.last_insert_rowid();
        drop(conn);
        state.audit("treatment.created", "treatment", Some(id), &format!("Treatment {name} created"), None, Some(payload.to_string()));
        Ok(json!({ "id": id }))
    })()
    .map_err(err)
}

#[tauri::command]
pub fn treatment_records_create(
    state: State<'_, AppState>,
    payload: Value,
) -> Result<Value, String> {
    (|| -> CmdResult<Value> {
        state.gate("treatment_records_create")?;
        let me = state.need("clinical.create_visit")?;
        let patient_id = util::req_int(payload.get("patientId").unwrap_or(&Value::Null), "patientId", 1, i64::MAX)?;
        let price = util::req_money(payload.get("price_paisa").unwrap_or(&Value::Null), "price")?;
        let qty = util::req_int(payload.get("qty").unwrap_or(&json!(1)), "qty", 1, 100)?;
        let date = util::req_date(payload.get("treatmentDate").unwrap_or(&json!(util::today())), "treatmentDate")?;
        let conn = state.conn.lock().unwrap();
        conn.execute("INSERT INTO treatment_records (visit_id, patient_id, treatment_id, custom_name, tooth_codes, price_paisa, qty, notes, dentist_id, treatment_date, created_by, created_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12)",
            params![util::opt_id(payload.get("visitId").unwrap_or(&Value::Null)), patient_id, util::opt_id(payload.get("treatmentId").unwrap_or(&Value::Null)),
                util::opt_text(payload.get("customName").unwrap_or(&Value::Null), 160), util::opt_text(payload.get("toothCodes").unwrap_or(&Value::Null), 120),
                price, qty, util::opt_text(payload.get("notes").unwrap_or(&Value::Null), 2000), util::opt_id(payload.get("dentistId").unwrap_or(&Value::Null)), date, me.id, util::now_local()])?;
        let id = conn.last_insert_rowid();
        drop(conn);
        state.audit("treatment_record.created", "treatment_record", Some(id), &format!("Treatment recorded for patient #{patient_id}"), None, Some(payload.to_string()));
        Ok(json!({ "id": id }))
    })()
    .map_err(err)
}

// ------------------------------------------------------------ medications
#[tauri::command]
pub fn medications_list(state: State<'_, AppState>, payload: Value) -> Result<Value, String> {
    (|| -> CmdResult<Value> {
        state.gate("medications_list")?;
        let conn = state.conn.lock().unwrap();
        let q = payload.get("search").and_then(serde_json::Value::as_str).unwrap_or("").trim().to_string();
        if q.is_empty() {
            util::query_all(&conn, "SELECT * FROM medication_catalog ORDER BY name", params!()).map(|v| json!(v))
        } else {
            let like = format!("%{q}%");
            util::query_all(&conn, "SELECT * FROM medication_catalog WHERE (name LIKE ?1 OR generic_name LIKE ?1) ORDER BY name", &[&like]).map(|v| json!(v))
        }
    })()
    .map_err(err)
}

#[tauri::command]
pub fn medications_save(state: State<'_, AppState>, payload: Value) -> Result<Value, String> {
    (|| -> CmdResult<Value> {
        state.gate("medications_save")?;
        state.need("treatments.manage")?;
        let name = util::req_text(payload.get("name").unwrap_or(&Value::Null), "Medicine name", 160)?;
        let conn = state.conn.lock().unwrap();
        let form = { let f = util::opt_text(payload.get("form").unwrap_or(&Value::Null), 48); if f.is_empty() { "Tablet".to_string() } else { f } };
        let g = |k: &str, m: usize| util::opt_text(payload.get(k).unwrap_or(&Value::Null), m);
        let active = if payload.get("active").and_then(serde_json::Value::as_bool).unwrap_or(true) { 1 } else { 0 };
        if let Some(id) = util::opt_id(payload.get("id").unwrap_or(&Value::Null)) {
            conn.execute("UPDATE medication_catalog SET name = ?1, generic_name = ?2, strength = ?3, form = ?4, route = ?5, default_dosage = ?6, default_duration = ?7, notes = ?8, active = ?9, updated_at = ?10 WHERE id = ?11",
                params![name, g("generic_name", 160), g("strength", 64), form, g("route", 64), g("default_dosage", 120), g("default_duration", 120), g("notes", 2000), active, util::now_local(), id])?;
            drop(conn);
            state.audit("medication.updated", "medication", Some(id), &format!("Medicine {name} updated"), None, Some(payload.to_string()));
            return Ok(json!({ "id": id }));
        }
        conn.execute("INSERT INTO medication_catalog (name, generic_name, strength, form, route, default_dosage, default_duration, notes, active, created_at, updated_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, 1, ?9, ?9)",
            params![name, g("generic_name", 160), g("strength", 64), form, g("route", 64), g("default_dosage", 120), g("default_duration", 120), g("notes", 2000), util::now_local()])?;
        let id = conn.last_insert_rowid();
        drop(conn);
        state.audit("medication.created", "medication", Some(id), &format!("Medicine {name} created"), None, Some(payload.to_string()));
        Ok(json!({ "id": id }))
    })()
    .map_err(err)
}

// ------------------------------------------------------------ prescriptions
#[tauri::command]
pub fn prescriptions_list(state: State<'_, AppState>, payload: Value) -> Result<Value, String> {
    (|| -> CmdResult<Value> {
        state.gate("prescriptions_list")?;
        state.need("clinical.view")?;
        let conn = state.conn.lock().unwrap();
        let mut conds: Vec<String> = Vec::new();
        let mut args: Vec<String> = Vec::new();
        if let Some(p) = payload.get("patientId").and_then(serde_json::Value::as_i64) {
            if p > 0 { conds.push(format!("r.patient_id = {p}")); }
        }
        if let Some(f) = payload.get("from").and_then(serde_json::Value::as_str) {
            if !f.is_empty() { conds.push(format!("r.prescription_date >= ?{}", args.len() + 1)); args.push(f.to_string()); }
        }
        if let Some(t) = payload.get("to").and_then(serde_json::Value::as_str) {
            if !t.is_empty() { conds.push(format!("r.prescription_date <= ?{}", args.len() + 1)); args.push(t.to_string()); }
        }
        if let Some(d) = payload.get("dentistId").and_then(serde_json::Value::as_i64) {
            if d > 0 { conds.push(format!("r.dentist_id = {d}")); }
        }
        if let Some(q) = payload.get("search").and_then(serde_json::Value::as_str) {
            if !q.is_empty() {
                conds.push(format!("(pt.name LIKE ?{} OR pt.code LIKE ?{})", args.len() + 1, args.len() + 1));
                args.push(format!("%{q}%"));
            }
        }
        let w = if conds.is_empty() { String::new() } else { format!("WHERE {}", conds.join(" AND ")) };
        let refs: Vec<&dyn rusqlite::ToSql> = args.iter().map(|v| v as &dyn rusqlite::ToSql).collect();
        util::query_all(&conn, &format!("SELECT r.*, pt.name AS patient_name, pt.code AS patient_code, d.name AS dentist_name,
            (SELECT COUNT(*) FROM prescription_items i WHERE i.prescription_id = r.id) AS item_count
            FROM prescriptions r JOIN patients pt ON pt.id = r.patient_id LEFT JOIN dentists d ON d.id = r.dentist_id
            {w} ORDER BY r.prescription_date DESC, r.id DESC LIMIT 500"), &refs).map(|v| json!(v))
    })()
    .map_err(err)
}

#[tauri::command]
pub fn prescriptions_get(state: State<'_, AppState>, payload: Value) -> Result<Value, String> {
    (|| -> CmdResult<Value> {
        state.gate("prescriptions_get")?;
        state.need("clinical.view")?;
        let id = util::req_int(payload.get("id").unwrap_or(&Value::Null), "id", 1, i64::MAX)?;
        let conn = state.conn.lock().unwrap();
        let rx = util::query_one(&conn, "SELECT r.*, pt.name AS patient_name, pt.code AS patient_code, pt.gender, pt.dob, pt.age_years, pt.phone, pt.address, d.name AS dentist_name FROM prescriptions r JOIN patients pt ON pt.id = r.patient_id LEFT JOIN dentists d ON d.id = r.dentist_id WHERE r.id = ?1", &[&id])?
            .ok_or_else(|| CmdError::new("NOT_FOUND", "Prescription not found."))?;
        let items = util::query_all(&conn, "SELECT * FROM prescription_items WHERE prescription_id = ?1 ORDER BY sort_order, id", &[&id])?;
        let designations: Vec<String> = util::query_all(&conn, "SELECT designation FROM dentist_designations WHERE dentist_id = (SELECT dentist_id FROM prescriptions WHERE id = ?1) ORDER BY sort_order", &[&id])?
            .iter().filter_map(|d| d["designation"].as_str().map(ToString::to_string)).collect();
        let mut out = rx.clone();
        out["items"] = json!(items);
        out["dentist_designations"] = json!(designations);
        Ok(out)
    })()
    .map_err(err)
}

#[tauri::command]
pub fn prescriptions_save(state: State<'_, AppState>, payload: Value) -> Result<Value, String> {
    (|| -> CmdResult<Value> {
        state.gate("prescriptions_save")?;
        let is_update = payload.get("id").and_then(serde_json::Value::as_i64).unwrap_or(0) > 0;
        let me = state.need(if is_update { "prescriptions.edit" } else { "prescriptions.create" })?;
        let patient_id = util::req_int(payload.get("patientId").unwrap_or(&Value::Null), "patientId", 1, i64::MAX)?;
        let items = payload.get("items").and_then(serde_json::Value::as_array).cloned().unwrap_or_default();
        if items.is_empty() {
            return Err(CmdError::new("VALIDATION", "At least one medication is required."));
        }
        if items.len() > 60 {
            return Err(CmdError::new("VALIDATION", "Too many medication items (max 60)."));
        }
        let date = util::req_date(payload.get("prescriptionDate").unwrap_or(&json!(util::today())), "prescriptionDate")?;
        let conn = state.conn.lock().unwrap();
        let mut rid = 0i64;
        txn(&conn, || {
            if is_update {
                rid = payload.get("id").and_then(serde_json::Value::as_i64).unwrap_or(0);
                let ex: i64 = conn.query_row("SELECT COUNT(*) FROM prescriptions WHERE id = ?1", [rid], |r| r.get(0))?;
                if ex == 0 {
                    return Err(CmdError::new("NOT_FOUND", "Prescription not found."));
                }
                conn.execute("UPDATE prescriptions SET patient_id = ?1, visit_id = ?2, dentist_id = ?3, prescription_date = ?4, cc_text = ?5, oe_text = ?6, re_text = ?7, advice = ?8, follow_up = ?9, notes = ?10 WHERE id = ?11",
                    params![patient_id, util::opt_id(payload.get("visitId").unwrap_or(&Value::Null)), util::opt_id(payload.get("dentistId").unwrap_or(&Value::Null)), date,
                        util::opt_text(payload.get("cc_text").unwrap_or(&Value::Null), 4000), util::opt_text(payload.get("oe_text").unwrap_or(&Value::Null), 4000),
                        util::opt_text(payload.get("re_text").unwrap_or(&Value::Null), 4000), util::opt_text(payload.get("advice").unwrap_or(&Value::Null), 4000),
                        util::opt_text(payload.get("followUp").unwrap_or(&Value::Null), 500), util::opt_text(payload.get("notes").unwrap_or(&Value::Null), 4000), rid])?;
                conn.execute("DELETE FROM prescription_items WHERE prescription_id = ?1", [rid])?;
            } else {
                conn.execute("INSERT INTO prescriptions (patient_id, visit_id, dentist_id, prescription_date, cc_text, oe_text, re_text, advice, follow_up, notes, created_by, created_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12)",
                    params![patient_id, util::opt_id(payload.get("visitId").unwrap_or(&Value::Null)), util::opt_id(payload.get("dentistId").unwrap_or(&Value::Null)), date,
                        util::opt_text(payload.get("cc_text").unwrap_or(&Value::Null), 4000), util::opt_text(payload.get("oe_text").unwrap_or(&Value::Null), 4000),
                        util::opt_text(payload.get("re_text").unwrap_or(&Value::Null), 4000), util::opt_text(payload.get("advice").unwrap_or(&Value::Null), 4000),
                        util::opt_text(payload.get("followUp").unwrap_or(&Value::Null), 500), util::opt_text(payload.get("notes").unwrap_or(&Value::Null), 4000), me.id, util::now_local()])?;
                rid = conn.last_insert_rowid();
            }
            for (idx, it) in items.iter().enumerate() {
                let med_name = util::req_text(it.get("medicine_name").unwrap_or(&Value::Null), &format!("Medication #{} name", idx + 1), 200)?;
                let form = { let f = util::opt_text(it.get("form").unwrap_or(&Value::Null), 48); if f.is_empty() { "Tablet".to_string() } else { f } };
                let ig = |k: &str, m: usize| util::opt_text(it.get(k).unwrap_or(&Value::Null), m);
                conn.execute("INSERT INTO prescription_items (prescription_id, medication_id, medicine_name, generic_name, strength, form, route, dosage, morning, noon, night, meal_relation, frequency, duration, quantity, instruction, prn, notes, sort_order) VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?12,?13,?14,?15,?16,?17,?18,?19)",
                    params![rid, util::opt_id(it.get("medication_id").unwrap_or(&Value::Null)), med_name, ig("generic_name", 200), ig("strength", 64), form,
                        ig("route", 64), ig("dosage", 120), ig("morning", 24), ig("noon", 24), ig("night", 24), ig("meal_relation", 48),
                        ig("frequency", 64), ig("duration", 64), ig("quantity", 64), ig("instruction", 500), ig("prn", 200), ig("notes", 500), idx as i64])?;
            }
            Ok(())
        })?;
        drop(conn);
        state.audit(if is_update { "prescription.updated" } else { "prescription.created" }, "prescription", Some(rid),
            &format!("Prescription #{rid} {} ({} item(s))", if is_update { "updated" } else { "created" }, items.len()), None, Some(json!({"patientId": patient_id}).to_string()));
        Ok(json!({ "id": rid }))
    })()
    .map_err(err)
}

#[tauri::command]
pub fn prescriptions_delete(state: State<'_, AppState>, payload: Value) -> Result<Value, String> {
    (|| -> CmdResult<Value> {
        state.gate("prescriptions_delete")?;
        state.need("prescriptions.edit")?;
        let id = util::req_int(payload.get("id").unwrap_or(&Value::Null), "id", 1, i64::MAX)?;
        let conn = state.conn.lock().unwrap();
        let before = util::query_one(&conn, "SELECT * FROM prescriptions WHERE id = ?1", &[&id])?
            .ok_or_else(|| CmdError::new("NOT_FOUND", "Prescription not found."))?;
        conn.execute("DELETE FROM prescriptions WHERE id = ?1", [id])?;
        drop(conn);
        state.audit(
            "prescription.deleted",
            "prescription",
            Some(id),
            &format!("Prescription #{id} deleted"),
            Some(before.to_string()),
            None,
        );
        Ok(json!({ "id": id }))
    })()
    .map_err(err)
}

// ------------------------------------------------------------ appointments
const APPT_STATUSES: [&str; 9] = [
    "Scheduled",
    "Confirmed",
    "Arrived",
    "In Queue",
    "In Progress",
    "Completed",
    "No Show",
    "Cancelled",
    "Rescheduled",
];

#[tauri::command]
pub fn appointments_list(state: State<'_, AppState>, payload: Value) -> Result<Value, String> {
    (|| -> CmdResult<Value> {
        state.gate("appointments_list")?;
        state.need("appointments.view")?;
        let conn = state.conn.lock().unwrap();
        let mut conds: Vec<String> = Vec::new();
        let mut args: Vec<String> = Vec::new();
        if let Some(f) = payload.get("from").and_then(serde_json::Value::as_str) {
            if !f.is_empty() { conds.push(format!("a.appt_date >= ?{}", args.len() + 1)); args.push(f.to_string()); }
        }
        if let Some(t) = payload.get("to").and_then(serde_json::Value::as_str) {
            if !t.is_empty() { conds.push(format!("a.appt_date <= ?{}", args.len() + 1)); args.push(t.to_string()); }
        }
        if let Some(d) = payload.get("dentistId").and_then(serde_json::Value::as_i64) {
            if d > 0 { conds.push(format!("a.dentist_id = {d}")); }
        }
        if let Some(s) = payload.get("status").and_then(serde_json::Value::as_str) {
            if !s.is_empty() { conds.push(format!("a.status = ?{}", args.len() + 1)); args.push(s.to_string()); }
        }
        if let Some(p) = payload.get("patientId").and_then(serde_json::Value::as_i64) {
            if p > 0 { conds.push(format!("a.patient_id = {p}")); }
        }
        if let Some(q) = payload.get("search").and_then(serde_json::Value::as_str) {
            if !q.is_empty() {
                conds.push(format!("(pt.name LIKE ?{} OR pt.code LIKE ?{} OR pt.phone LIKE ?{})", args.len() + 1, args.len() + 1, args.len() + 1));
                args.push(format!("%{q}%"));
            }
        }
        let w = if conds.is_empty() { String::new() } else { format!("WHERE {}", conds.join(" AND ")) };
        let refs: Vec<&dyn rusqlite::ToSql> = args.iter().map(|v| v as &dyn rusqlite::ToSql).collect();
        util::query_all(&conn, &format!("SELECT a.*, pt.name AS patient_name, pt.code AS patient_code, pt.phone AS patient_phone, d.name AS dentist_name
            FROM appointments a JOIN patients pt ON pt.id = a.patient_id LEFT JOIN dentists d ON d.id = a.dentist_id
            {w} ORDER BY a.appt_date ASC, a.appt_time ASC LIMIT 2000"), &refs).map(|v| json!(v))
    })()
    .map_err(err)
}

#[tauri::command]
pub fn appointments_save(state: State<'_, AppState>, payload: Value) -> Result<Value, String> {
    (|| -> CmdResult<Value> {
        state.gate("appointments_save")?;
        let me = state.need("appointments.manage")?;
        let patient_id = util::req_int(payload.get("patientId").unwrap_or(&Value::Null), "patientId", 1, i64::MAX)?;
        let date = util::req_date(payload.get("apptDate").unwrap_or(&Value::Null), "apptDate")?;
        let time = util::req_text(payload.get("apptTime").unwrap_or(&Value::Null), "apptTime", 8)?;
        let time_ok = time.len() >= 4 && time.chars().take_while(|c| *c != ':').all(|c| c.is_ascii_digit()) && time.contains(':');
        if !time_ok {
            return Err(CmdError::new("VALIDATION", "Appointment time is invalid."));
        }
        let status = payload.get("status").and_then(serde_json::Value::as_str).unwrap_or("Scheduled");
        if !APPT_STATUSES.contains(&status) {
            return Err(CmdError::new("VALIDATION", "Invalid appointment status."));
        }
        let duration = util::req_int(payload.get("durationMin").unwrap_or(&json!(30)), "duration", 5, 480)?;
        let conn = state.conn.lock().unwrap();
        let appt_type = { let t = util::opt_text(payload.get("apptType").unwrap_or(&Value::Null), 64); if t.is_empty() { "General".to_string() } else { t } };
        if let Some(id) = util::opt_id(payload.get("id").unwrap_or(&Value::Null)) {
            let before = util::query_one(&conn, "SELECT * FROM appointments WHERE id = ?1", &[&id])?
                .ok_or_else(|| CmdError::new("NOT_FOUND", "Appointment not found."))?;
            conn.execute("UPDATE appointments SET patient_id = ?1, dentist_id = ?2, appt_date = ?3, appt_time = ?4, duration_min = ?5, reason = ?6, appt_type = ?7, notes = ?8, status = ?9, updated_at = ?10 WHERE id = ?11",
                params![patient_id, util::opt_id(payload.get("dentistId").unwrap_or(&Value::Null)), date, time, duration,
                    util::opt_text(payload.get("reason").unwrap_or(&Value::Null), 500), appt_type, util::opt_text(payload.get("notes").unwrap_or(&Value::Null), 2000), status, util::now_local(), id])?;
            drop(conn);
            state.audit("appointment.updated", "appointment", Some(id), &format!("Appointment #{id} → {status}"), Some(before.to_string()), Some(payload.to_string()));
            return Ok(json!({ "id": id }));
        }
        conn.execute("INSERT INTO appointments (patient_id, dentist_id, appt_date, appt_time, duration_min, reason, appt_type, notes, status, created_by, created_at, updated_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?11)",
            params![patient_id, util::opt_id(payload.get("dentistId").unwrap_or(&Value::Null)), date, time, duration,
                util::opt_text(payload.get("reason").unwrap_or(&Value::Null), 500), appt_type, util::opt_text(payload.get("notes").unwrap_or(&Value::Null), 2000), status, me.id, util::now_local()])?;
        let id = conn.last_insert_rowid();
        drop(conn);
        state.audit("appointment.created", "appointment", Some(id), &format!("Appointment #{id} scheduled ({date} {time})"), None, Some(payload.to_string()));
        if date == util::today() {
            state.notify("info", "appointment", "Appointment today", &format!("Appointment #{id} scheduled for today at {time}."), Some("appointment"), Some(id), Some("appointments"));
        }
        Ok(json!({ "id": id }))
    })()
    .map_err(err)
}

#[tauri::command]
pub fn appointments_delete(state: State<'_, AppState>, payload: Value) -> Result<Value, String> {
    (|| -> CmdResult<Value> {
        state.gate("appointments_delete")?;
        state.need("appointments.manage")?;
        let id = util::req_int(payload.get("id").unwrap_or(&Value::Null), "id", 1, i64::MAX)?;
        let conn = state.conn.lock().unwrap();
        let before = util::query_one(&conn, "SELECT * FROM appointments WHERE id = ?1", &[&id])?
            .ok_or_else(|| CmdError::new("NOT_FOUND", "Appointment not found."))?;
        conn.execute("DELETE FROM appointments WHERE id = ?1", [id])?;
        drop(conn);
        state.audit(
            "appointment.deleted",
            "appointment",
            Some(id),
            &format!("Appointment #{id} deleted"),
            Some(before.to_string()),
            None,
        );
        Ok(json!({ "id": id }))
    })()
    .map_err(err)
}

// ------------------------------------------------------------ queue
#[tauri::command]
pub fn queue_list(state: State<'_, AppState>, payload: Value) -> Result<Value, String> {
    (|| -> CmdResult<Value> {
        state.gate("queue_list")?;
        state.need("queue.manage")?;
        let date = payload.get("date").and_then(serde_json::Value::as_str).unwrap_or("");
        let date = if date.is_empty() { util::today() } else { date.to_string() };
        let conn = state.conn.lock().unwrap();
        util::query_all(&conn, "SELECT q.*, pt.name AS patient_name, pt.code AS patient_code, d.name AS dentist_name
            FROM queue_entries q JOIN patients pt ON pt.id = q.patient_id LEFT JOIN dentists d ON d.id = q.dentist_id
            WHERE q.queue_date = ?1 ORDER BY CASE q.status WHEN 'in_progress' THEN 0 WHEN 'called' THEN 1 WHEN 'waiting' THEN 2 WHEN 'hold' THEN 3 ELSE 4 END, q.queue_no ASC", &[&date]).map(|v| json!(v))
    })()
    .map_err(err)
}

#[tauri::command]
pub fn queue_add(state: State<'_, AppState>, payload: Value) -> Result<Value, String> {
    (|| -> CmdResult<Value> {
        state.gate("queue_add")?;
        state.need("queue.manage")?;
        let date = payload.get("date").and_then(serde_json::Value::as_str).unwrap_or("");
        let date = if date.is_empty() { util::today() } else { date.to_string() };
        let patient_id = util::req_int(payload.get("patientId").unwrap_or(&Value::Null), "patientId", 1, i64::MAX)?;
        let conn = state.conn.lock().unwrap();
        let existing: i64 = conn.query_row("SELECT COUNT(*) FROM queue_entries WHERE queue_date = ?1 AND patient_id = ?2 AND status IN ('waiting','called','in_progress','hold')",
            params![date, patient_id], |r| r.get(0))?;
        if existing > 0 {
            return Err(CmdError::new("DUPLICATE", "Patient is already in the queue for this date."));
        }
        let max_no: i64 = conn.query_row("SELECT COALESCE(MAX(queue_no), 0) FROM queue_entries WHERE queue_date = ?1", [&date], |r| r.get(0)).unwrap_or(0);
        let priority = payload.get("priority").and_then(serde_json::Value::as_str).unwrap_or("normal");
        let priority = if ["normal", "urgent", "vip"].contains(&priority) { priority } else { "normal" };
        let appt_id = util::opt_id(payload.get("appointmentId").unwrap_or(&Value::Null));
        conn.execute("INSERT INTO queue_entries (appointment_id, patient_id, dentist_id, queue_no, queue_date, arrival_time, priority, status, notes, created_at, updated_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, 'waiting', ?8, ?9, ?9)",
            params![appt_id, patient_id, util::opt_id(payload.get("dentistId").unwrap_or(&Value::Null)), max_no + 1, date, util::now_local(), priority,
                util::opt_text(payload.get("notes").unwrap_or(&Value::Null), 500), util::now_local()])?;
        let id = conn.last_insert_rowid();
        if let Some(aid) = appt_id {
            conn.execute("UPDATE appointments SET status = 'In Queue', updated_at = ?1 WHERE id = ?2", params![util::now_local(), aid])?;
        }
        drop(conn);
        state.audit("queue.added", "queue", Some(id), &format!("Patient #{patient_id} added to queue (#{}))", max_no + 1), None, Some(json!({"date": date}).to_string()));
        Ok(json!({ "id": id, "queueNo": max_no + 1 }))
    })()
    .map_err(err)
}

#[tauri::command]
pub fn queue_action(state: State<'_, AppState>, payload: Value) -> Result<Value, String> {
    (|| -> CmdResult<Value> {
        state.gate("queue_action")?;
        state.need("queue.manage")?;
        let id = util::req_int(payload.get("id").unwrap_or(&Value::Null), "id", 1, i64::MAX)?;
        let action = payload.get("action").and_then(serde_json::Value::as_str).unwrap_or("");
        let next = match action {
            "call" => "called",
            "start" => "in_progress",
            "hold" => "hold",
            "return" => "waiting",
            "complete" => "completed",
            "cancel" => "cancelled",
            _ => return Err(CmdError::new("VALIDATION", "Invalid queue action.")),
        };
        let conn = state.conn.lock().unwrap();
        let q = util::query_one(&conn, "SELECT * FROM queue_entries WHERE id = ?1", &[&id])?
            .ok_or_else(|| CmdError::new("NOT_FOUND", "Queue entry not found."))?;
        let prev_status = q["status"].as_str().unwrap_or("").to_string();
        let appt_id = q["appointment_id"].as_i64();
        let queue_no = q["queue_no"].as_i64().unwrap_or(0);
        txn(&conn, || {
            conn.execute("UPDATE queue_entries SET status = ?1, called_at = CASE WHEN ?1 = 'called' THEN ?2 ELSE called_at END, started_at = CASE WHEN ?1 = 'in_progress' THEN ?2 ELSE started_at END, completed_at = CASE WHEN ?1 IN ('completed','cancelled') THEN ?2 ELSE completed_at END, updated_at = ?2 WHERE id = ?3",
                params![next, util::now_local(), id])?;
            if let Some(aid) = appt_id {
                if next == "completed" || next == "cancelled" {
                    conn.execute("UPDATE appointments SET status = ?1, updated_at = ?2 WHERE id = ?3",
                        params![if next == "completed" { "Completed" } else { "Cancelled" }, util::now_local(), aid])?;
                }
                if next == "in_progress" {
                    conn.execute("UPDATE appointments SET status = 'In Progress', updated_at = ?1 WHERE id = ?2", params![util::now_local(), aid])?;
                }
            }
            Ok(())
        })?;
        drop(conn);
        state.audit("queue.updated", "queue", Some(id), &format!("Queue #{queue_no} → {next}"),
            Some(json!({"status": prev_status}).to_string()), Some(json!({"status": next}).to_string()));
        Ok(json!({ "id": id, "status": next }))
    })()
    .map_err(err)
}

// ------------------------------------------------------------ referrals
#[tauri::command]
pub fn referrals_list(state: State<'_, AppState>, payload: Value) -> Result<Value, String> {
    (|| -> CmdResult<Value> {
        state.gate("referrals_list")?;
        state.need("clinical.view")?;
        let id = util::req_int(
            payload.get("patientId").unwrap_or(&Value::Null),
            "patientId",
            1,
            i64::MAX,
        )?;
        let conn = state.conn.lock().unwrap();
        util::query_all(
            &conn,
            "SELECT * FROM patient_referrals WHERE patient_id = ?1 ORDER BY referral_date DESC",
            &[&id],
        )
        .map(|v| json!(v))
    })()
    .map_err(err)
}

#[tauri::command]
pub fn referrals_save(state: State<'_, AppState>, payload: Value) -> Result<Value, String> {
    (|| -> CmdResult<Value> {
        state.gate("referrals_save")?;
        let me = state.need("clinical.referral")?;
        let patient_id = util::req_int(payload.get("patientId").unwrap_or(&Value::Null), "patientId", 1, i64::MAX)?;
        let date = util::req_date(payload.get("referralDate").unwrap_or(&json!(util::today())), "referralDate")?;
        let status = { let s = util::opt_text(payload.get("status").unwrap_or(&Value::Null), 32); if s.is_empty() { "open".to_string() } else { s } };
        let conn = state.conn.lock().unwrap();
        let g = |k: &str, m: usize| util::opt_text(payload.get(k).unwrap_or(&Value::Null), m);
        if let Some(id) = util::opt_id(payload.get("id").unwrap_or(&Value::Null)) {
            conn.execute("UPDATE patient_referrals SET referred_by = ?1, referred_to = ?2, specialty = ?3, reason = ?4, referral_date = ?5, notes = ?6, follow_up = ?7, status = ?8 WHERE id = ?9",
                params![g("referredBy", 200), g("referredTo", 200), g("specialty", 120), g("reason", 2000), date, g("notes", 2000), g("followUp", 500), status, id])?;
            drop(conn);
            state.audit("referral.updated", "referral", Some(id), &format!("Referral #{id} updated"), None, Some(payload.to_string()));
            return Ok(json!({ "id": id }));
        }
        conn.execute("INSERT INTO patient_referrals (patient_id, referred_by, referred_to, specialty, reason, referral_date, notes, follow_up, status, created_by, created_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11)",
            params![patient_id, g("referredBy", 200), g("referredTo", 200), g("specialty", 120), g("reason", 2000), date, g("notes", 2000), g("followUp", 500), status, me.id, util::now_local()])?;
        let id = conn.last_insert_rowid();
        drop(conn);
        state.audit("referral.created", "referral", Some(id), &format!("Referral #{id} created for patient #{patient_id}"), None, Some(payload.to_string()));
        Ok(json!({ "id": id }))
    })()
    .map_err(err)
}

#[tauri::command]
pub fn referrals_delete(state: State<'_, AppState>, payload: Value) -> Result<Value, String> {
    (|| -> CmdResult<Value> {
        state.gate("referrals_delete")?;
        state.need("clinical.referral")?;
        let id = util::req_int(payload.get("id").unwrap_or(&Value::Null), "id", 1, i64::MAX)?;
        let conn = state.conn.lock().unwrap();
        conn.execute("DELETE FROM patient_referrals WHERE id = ?1", [id])?;
        drop(conn);
        state.audit(
            "referral.deleted",
            "referral",
            Some(id),
            &format!("Referral #{id} deleted"),
            None,
            None,
        );
        Ok(json!({ "id": id }))
    })()
    .map_err(err)
}
