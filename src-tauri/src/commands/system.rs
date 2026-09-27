// Dentiva Pro — system commands (native backend). Mirrors the fallback backend
// exactly: same command names, arguments, SQL, return shapes, error codes.

use rusqlite::params;
use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use tauri::State;

use crate::ctx::{permission_set, AppState};
use crate::db;
use crate::error::{CmdError, CmdResult};
use crate::util;

fn err(e: CmdError) -> String {
    e.to_string()
}

fn sha256_hex_str(s: &str) -> String {
    let mut h = Sha256::new();
    h.update(s.as_bytes());
    format!("{:x}", h.finalize())
}

// ------------------------------------------------------------ status/activate
#[tauri::command]
pub fn app_status(state: State<'_, AppState>) -> Result<Value, String> {
    (|| -> CmdResult<Value> {
        state.gate("app_status")?;
        let conn = state.conn.lock().unwrap();
        let activated = util::meta_get(&conn, "activated") == "1";
        let setup_complete = util::meta_get(&conn, "setup_complete") == "1";
        let mins: i64 = util::setting(&conn, "auto_lock_minutes", "15")
            .parse()
            .unwrap_or(15);
        let locked = *state.locked.lock().unwrap();
        let session = if locked {
            None
        } else {
            state.session.lock().unwrap().clone()
        };
        let integrity_warning =
            match conn.query_row("PRAGMA quick_check", (), |r| r.get::<_, String>(0)) {
                Ok(v) if v == "ok" => String::new(),
                _ => util::now_local(),
            };
        Ok(json!({
            "backend": "tauri",
            "version": db::APP_VERSION,
            "schemaVersion": db::SCHEMA_VERSION,
            "activated": activated,
            "setupComplete": setup_complete,
            "locked": locked,
            "installId": state.install_id,
            "session": session,
            "autoLockMinutes": mins,
            "integrityWarning": integrity_warning,
        }))
    })()
    .map_err(err)
}

#[tauri::command]
pub fn activate(state: State<'_, AppState>, payload: Value) -> Result<Value, String> {
    (|| -> CmdResult<Value> {
        state.gate("activate")?;
        let code = payload
            .get("code")
            .and_then(serde_json::Value::as_str)
            .unwrap_or("");
        if !crate::activation::verify_activation_code(code) {
            state.audit(
                "activation.failed",
                "activation",
                None,
                "Failed activation attempt",
                None,
                None,
            );
            return Err(CmdError::new(
                "ACTIVATION_INVALID",
                "Invalid activation code. Please check the code and try again.",
            ));
        }
        let conn = state.conn.lock().unwrap();
        let receipt = crate::activation::activation_receipt(&state.install_id);
        util::meta_set(&conn, "activated", "1")?;
        util::meta_set(&conn, "activation_receipt", &receipt)?;
        util::meta_set(&conn, "activated_at", &util::now_local())?;
        std::fs::write(&state.paths.receipt_path, format!("{receipt}\n"))?;
        drop(conn);
        state.audit(
            "activation.completed",
            "activation",
            None,
            "Application activated",
            None,
            None,
        );
        Ok(json!({ "ok": true }))
    })()
    .map_err(err)
}

// ------------------------------------------------------------ setup wizard
#[tauri::command]
pub fn setup_init(state: State<'_, AppState>, payload: Value) -> Result<Value, String> {
    (|| -> CmdResult<Value> {
        state.gate("setup_init")?;
        let conn = state.conn.lock().unwrap();
        if util::meta_get(&conn, "activated") != "1" {
            return Err(CmdError::new("NOT_ACTIVATED", "Activation is required before setup."));
        }
        if util::meta_get(&conn, "setup_complete") == "1" {
            return Err(CmdError::new("ALREADY_SETUP", "Setup has already been completed."));
        }
        let clinic_v = payload.get("clinic").unwrap_or(&Value::Null);
        let dentists_v = payload.get("dentists").and_then(serde_json::Value::as_array).cloned().unwrap_or_default();
        let admin_v = payload.get("admin").unwrap_or(&Value::Null);
        let prefs_v = payload.get("preferences").unwrap_or(&Value::Null);
        let backup_v = payload.get("backup").unwrap_or(&Value::Null);
        let security_v = payload.get("security").unwrap_or(&Value::Null);
        let clinic_name = util::req_text(clinic_v.get("name").unwrap_or(&Value::Null), "Clinic name", 200)?;
        if dentists_v.is_empty() {
            return Err(CmdError::new("VALIDATION", "At least one dentist is required."));
        }
        let full_name = util::req_text(admin_v.get("fullName").unwrap_or(&Value::Null), "Full name", 120)?;
        let username = util::req_text(admin_v.get("username").unwrap_or(&Value::Null), "Username", 32)?;
        if username.len() < 3 || !username.chars().all(|c| c.is_ascii_alphanumeric() || c == '.' || c == '_' || c == '-') {
            return Err(CmdError::new("VALIDATION", "Username must be 3–32 chars (letters, digits, . _ -)."));
        }
        let password = admin_v.get("password").and_then(serde_json::Value::as_str).unwrap_or("");
        if password.len() < 8 {
            return Err(CmdError::new("VALIDATION", "Password must be at least 8 characters."));
        }
        let hash = crate::auth::hash_password(password)?;
        let now = util::now_local();
        let gv = |v: &Value, k: &str, m: usize| util::opt_text(v.get(k).unwrap_or(&Value::Null), m);
        conn.execute_batch("BEGIN IMMEDIATE")?;
        let res: CmdResult<()> = (|| {
            conn.execute(
                "UPDATE clinic SET name = ?1, address = ?2, phone = ?3, email = ?4, website = ?5, opening_hours = ?6, closing_hours = ?7, weekly_off = ?8, message = ?9, footer_text = ?10, updated_at = ?11 WHERE id = 1",
                params![clinic_name, gv(clinic_v, "address", 500), gv(clinic_v, "phone", 120), gv(clinic_v, "email", 120), gv(clinic_v, "website", 120),
                    gv(clinic_v, "openingHours", 60), gv(clinic_v, "closingHours", 60), gv(clinic_v, "weeklyOff", 120),
                    gv(clinic_v, "message", 1000), gv(clinic_v, "footerText", 1000), now],
            )?;
            for (i, dt) in dentists_v.iter().enumerate() {
                let nm = util::req_text(dt.get("name").unwrap_or(&Value::Null), &format!("Dentist #{} name", i + 1), 160)?;
                conn.execute("INSERT INTO dentists (name, phone, email, registration_no, active, sort_order, created_at, updated_at) VALUES (?1, ?2, ?3, ?4, 1, ?5, ?6, ?6)",
                    params![nm, gv(dt, "phone", 64), gv(dt, "email", 120), gv(dt, "registrationNo", 120), i as i64, now])?;
                let did = conn.last_insert_rowid();
                if let Some(des) = dt.get("designations").and_then(serde_json::Value::as_array) {
                    for (j, g) in des.iter().take(10).enumerate() {
                        let s = g.as_str().unwrap_or("").trim().chars().take(200).collect::<String>();
                        if !s.is_empty() {
                            conn.execute("INSERT INTO dentist_designations (dentist_id, designation, sort_order) VALUES (?1, ?2, ?3)", params![did, s, j as i64])?;
                        }
                    }
                }
            }
            let owner_role: i64 = conn.query_row("SELECT id FROM roles WHERE name = 'Owner'", (), |r| r.get(0))?;
            conn.execute("INSERT INTO users (full_name, username, password_hash, role_id, active, created_at, updated_at) VALUES (?1, ?2, ?3, ?4, 1, ?5, ?5)",
                params![full_name, username, hash, owner_role, now])?;
            let pref_map = [
                ("date_format", prefs_v.get("dateFormat").and_then(serde_json::Value::as_str).unwrap_or("DD MMM YYYY")),
                ("time_format", prefs_v.get("timeFormat").and_then(serde_json::Value::as_str).unwrap_or("12h")),
                ("default_paper_size", prefs_v.get("paperSize").and_then(serde_json::Value::as_str).unwrap_or("A4")),
                ("auto_lock_minutes", security_v.get("autoLock").and_then(serde_json::Value::as_str).unwrap_or("15")),
                ("backup_location", backup_v.get("location").and_then(serde_json::Value::as_str).unwrap_or("")),
                ("auto_backup_days", backup_v.get("scheduleDays").and_then(serde_json::Value::as_str).unwrap_or("7")),
                ("invoice_tax_percent", prefs_v.get("taxPercent").and_then(serde_json::Value::as_str).unwrap_or("0")),
            ];
            for (k, v) in pref_map {
                conn.execute("UPDATE app_settings SET value = ?1, updated_at = ?2 WHERE key = ?3", params![v.chars().take(200).collect::<String>(), now, k])?;
            }
            conn.execute("INSERT INTO meta (key, value) VALUES ('setup_complete', '1') ON CONFLICT(key) DO UPDATE SET value = '1'", ())?;
            Ok(())
        })();
        match res {
            Ok(()) => { conn.execute_batch("COMMIT")?; }
            Err(e) => { let _ = conn.execute_batch("ROLLBACK"); return Err(e); }
        }
        drop(conn);
        state.audit("setup.completed", "setup", None, &format!("Initial setup completed for {clinic_name}"), None, None);
        Ok(json!({ "ok": true }))
    })()
    .map_err(err)
}

// ------------------------------------------------------------ auth
#[tauri::command]
pub fn login(state: State<'_, AppState>, payload: Value) -> Result<Value, String> {
    (|| -> CmdResult<Value> {
        state.gate("login")?;
        let username = util::req_text(payload.get("username").unwrap_or(&Value::Null), "Username", 32)?;
        let password = payload.get("password").and_then(serde_json::Value::as_str).unwrap_or("");
        let conn = state.conn.lock().unwrap();
        let u = util::query_one(&conn, "SELECT u.*, r.name AS role_name FROM users u JOIN roles r ON r.id = u.role_id WHERE LOWER(u.username) = LOWER(?1)", &[&username])?;
        let Some(u) = u else {
            drop(conn);
            state.audit("auth.failed", "user", None, &format!("Failed login for \"{username}\" (unknown/disabled)"), None, None);
            return Err(CmdError::new("AUTH_FAILED", "Invalid username or password."));
        };
        if u["active"].as_i64().unwrap_or(0) != 1 {
            drop(conn);
            state.audit("auth.failed", "user", None, &format!("Failed login for \"{username}\" (unknown/disabled)"), None, None);
            return Err(CmdError::new("AUTH_FAILED", "Invalid username or password."));
        }
        if let Some(locked_until) = u["locked_until"].as_str() {
            if locked_until > util::now_local().as_str() {
                return Err(CmdError::new("ACCOUNT_LOCKED", "Account is temporarily locked due to failed attempts. Please try again later."));
            }
        }
        let stored = u["password_hash"].as_str().unwrap_or("");
        let id = u["id"].as_i64().unwrap_or(0);
        if !crate::auth::verify_password(password, stored) {
            let fails = u["failed_attempts"].as_i64().unwrap_or(0) + 1;
            let lock_until = if fails >= 5 {
                Some((chrono::Local::now() + chrono::Duration::minutes(5)).format("%Y-%m-%dT%H:%M:%S").to_string())
            } else {
                None
            };
            conn.execute("UPDATE users SET failed_attempts = ?1, locked_until = ?2 WHERE id = ?3", params![fails, lock_until, id])?;
            drop(conn);
            state.audit("auth.failed", "user", Some(id), &format!("Failed login for \"{username}\" ({fails} attempt(s))"), None, None);
            return Err(CmdError::new("AUTH_FAILED", if fails >= 5 { "Invalid username or password. Account locked for 5 minutes." } else { "Invalid username or password." }));
        }
        conn.execute("UPDATE users SET failed_attempts = 0, locked_until = NULL, last_login_at = ?1 WHERE id = ?2", params![util::now_local(), id])?;
        let session = crate::ctx::SessionUser {
            id,
            full_name: u["full_name"].as_str().unwrap_or("").to_string(),
            username: u["username"].as_str().unwrap_or("").to_string(),
            role_id: u["role_id"].as_i64().unwrap_or(0),
            role_name: u["role_name"].as_str().unwrap_or("").to_string(),
            permissions: permission_set(&conn, id),
        };
        conn.execute("UPDATE app_lock_state SET locked = 0, locked_by = NULL WHERE id = 1", ())?;
        drop(conn);
        *state.session.lock().unwrap() = Some(session.clone());
        *state.locked.lock().unwrap() = false;
        state.audit("auth.login", "user", Some(id), &format!("User \"{username}\" logged in"), None, None);
        refresh_system_notifications(&state);
        Ok(json!({ "session": session }))
    })()
    .map_err(err)
}

#[tauri::command]
pub fn logout(state: State<'_, AppState>) -> Result<Value, String> {
    (|| -> CmdResult<Value> {
        state.gate("logout")?;
        let s = state.session.lock().unwrap().clone();
        if let Some(u) = s {
            state.audit(
                "auth.logout",
                "user",
                Some(u.id),
                &format!("User \"{}\" logged out", u.username),
                None,
                None,
            );
        }
        *state.session.lock().unwrap() = None;
        *state.locked.lock().unwrap() = false;
        Ok(json!({ "ok": true }))
    })()
    .map_err(err)
}

#[tauri::command]
pub fn lock_app(state: State<'_, AppState>) -> Result<Value, String> {
    (|| -> CmdResult<Value> {
        state.gate("lock_app")?;
        let sid = state.session.lock().unwrap().clone().map(|s| s.id);
        *state.locked.lock().unwrap() = true;
        let conn = state.conn.lock().unwrap();
        conn.execute(
            "UPDATE app_lock_state SET locked = 1, locked_at = ?1, locked_by = ?2 WHERE id = 1",
            params![util::now_local(), sid],
        )?;
        Ok(json!({ "ok": true }))
    })()
    .map_err(err)
}

#[tauri::command]
pub fn unlock(state: State<'_, AppState>, payload: Value) -> Result<Value, String> {
    (|| -> CmdResult<Value> {
        state.gate("unlock")?;
        let s = state
            .session
            .lock()
            .unwrap()
            .clone()
            .ok_or_else(|| CmdError::new("UNAUTHENTICATED", "Please log in."))?;
        let conn = state.conn.lock().unwrap();
        let u = util::query_one(&conn, "SELECT * FROM users WHERE id = ?1", &[&s.id])?;
        let active = u.as_ref().and_then(|x| x["active"].as_i64()).unwrap_or(0) == 1;
        let stored = u
            .as_ref()
            .and_then(|x| x["password_hash"].as_str())
            .unwrap_or("")
            .to_string();
        if u.is_none() || !active {
            return Err(CmdError::new("AUTH_FAILED", "Account is disabled."));
        }
        if !crate::auth::verify_password(
            payload
                .get("password")
                .and_then(serde_json::Value::as_str)
                .unwrap_or(""),
            &stored,
        ) {
            drop(conn);
            state.audit(
                "auth.unlock_failed",
                "user",
                Some(s.id),
                "Failed unlock attempt",
                None,
                None,
            );
            return Err(CmdError::new("AUTH_FAILED", "Incorrect password."));
        }
        conn.execute("UPDATE app_lock_state SET locked = 0 WHERE id = 1", ())?;
        drop(conn);
        *state.locked.lock().unwrap() = false;
        Ok(json!({ "ok": true }))
    })()
    .map_err(err)
}

#[tauri::command]
pub fn change_password(state: State<'_, AppState>, payload: Value) -> Result<Value, String> {
    (|| -> CmdResult<Value> {
        state.gate("change_password")?;
        if *state.locked.lock().unwrap() {
            return Err(CmdError::new(
                "LOCKED",
                "Application is locked. Please unlock to continue.",
            ));
        }
        let s = state
            .optional_session()
            .ok_or_else(|| CmdError::new("UNAUTHENTICATED", "Please log in."))?;
        let conn = state.conn.lock().unwrap();
        let u = util::query_one(&conn, "SELECT * FROM users WHERE id = ?1", &[&s.id])?
            .ok_or_else(|| CmdError::new("NOT_FOUND", "User not found."))?;
        if !crate::auth::verify_password(
            payload
                .get("current")
                .and_then(serde_json::Value::as_str)
                .unwrap_or(""),
            u["password_hash"].as_str().unwrap_or(""),
        ) {
            return Err(CmdError::new(
                "AUTH_FAILED",
                "Current password is incorrect.",
            ));
        }
        let next = payload
            .get("next")
            .and_then(serde_json::Value::as_str)
            .unwrap_or("");
        if next.len() < 8 {
            return Err(CmdError::new(
                "VALIDATION",
                "New password must be at least 8 characters.",
            ));
        }
        conn.execute(
            "UPDATE users SET password_hash = ?1 WHERE id = ?2",
            params![crate::auth::hash_password(next)?, s.id],
        )?;
        drop(conn);
        state.audit(
            "auth.password_changed",
            "user",
            Some(s.id),
            "Password changed",
            None,
            None,
        );
        Ok(json!({ "ok": true }))
    })()
    .map_err(err)
}

// ------------------------------------------------------------ settings
#[tauri::command]
pub fn settings_get(state: State<'_, AppState>, payload: Value) -> Result<Value, String> {
    (|| -> CmdResult<Value> {
        state.gate("settings_get")?;
        let conn = state.conn.lock().unwrap();
        let mut map = serde_json::Map::new();
        if let Some(keys) = payload.get("keys").and_then(serde_json::Value::as_array) {
            if !keys.is_empty() {
                for k in keys {
                    if let Some(key) = k.as_str() {
                        map.insert(key.to_string(), json!(util::setting(&conn, key, "")));
                    }
                }
                return Ok(json!(map));
            }
        }
        for r in util::query_all(&conn, "SELECT key, value FROM app_settings", params!())? {
            map.insert(
                r["key"].as_str().unwrap_or("").to_string(),
                json!(r["value"].as_str().unwrap_or("")),
            );
        }
        Ok(json!(map))
    })()
    .map_err(err)
}

#[tauri::command]
pub fn settings_set(state: State<'_, AppState>, payload: Value) -> Result<Value, String> {
    (|| -> CmdResult<Value> {
        state.gate("settings_set")?;
        state.need("settings.manage")?;
        let conn = state.conn.lock().unwrap();
        let values = payload.get("values").and_then(|v| v.as_object()).cloned().unwrap_or_default();
        let now = util::now_local();
        let mut before = serde_json::Map::new();
        for (k, v) in values.iter().take(60) {
            if k.len() > 64 || !k.bytes().all(|b| b.is_ascii_lowercase() || b.is_ascii_digit() || b == b'_') {
                continue;
            }
            before.insert(k.clone(), json!(util::setting(&conn, k, "")));
            let val = v.as_str().unwrap_or("").chars().take(4000).collect::<String>();
            conn.execute("INSERT INTO app_settings (key, value, updated_at) VALUES (?1, ?2, ?3) ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at",
                params![k, val, now])?;
        }
        drop(conn);
        state.audit("settings.updated", "settings", None, &format!("Settings updated ({} key(s))", values.len()),
            Some(json!(before).to_string()), Some(json!(values).to_string()));
        Ok(json!({ "ok": true }))
    })()
    .map_err(err)
}

// ------------------------------------------------------------ dashboard
#[tauri::command]
pub fn dashboard_stats(state: State<'_, AppState>) -> Result<Value, String> {
    (|| -> CmdResult<Value> {
        state.gate("dashboard_stats")?;
        let s = state.optional_session().ok_or_else(|| CmdError::new("UNAUTHENTICATED", "Please log in."))?;
        let can = |c: &str| s.permissions.iter().any(|p| p == "*" || p == c);
        let conn = state.conn.lock().unwrap();
        let today = util::today();
        let mut out = serde_json::Map::new();
        out.insert("date".to_string(), json!(today));
        if can("patients.view") {
            out.insert("todayPatients".to_string(), json!(conn.query_row("SELECT COUNT(DISTINCT v.patient_id) FROM visits v WHERE v.visit_date = ?1", [&today], |r| r.get::<_, i64>(0)).unwrap_or(0)));
            out.insert("newPatients".to_string(), json!(conn.query_row("SELECT COUNT(*) FROM patients WHERE reg_date = ?1", [&today], |r| r.get::<_, i64>(0)).unwrap_or(0)));
            out.insert("totalPatients".to_string(), json!(conn.query_row("SELECT COUNT(*) FROM patients WHERE archived = 0", (), |r| r.get::<_, i64>(0)).unwrap_or(0)));
            out.insert("recentPatients".to_string(), json!(util::query_all(&conn, "SELECT id, code, name, phone, reg_date FROM patients ORDER BY id DESC LIMIT 8", params!())?));
        }
        if can("appointments.view") {
            out.insert("todayAppointments".to_string(), json!(conn.query_row("SELECT COUNT(*) FROM appointments WHERE appt_date = ?1 AND status NOT IN ('Cancelled','No Show')", [&today], |r| r.get::<_, i64>(0)).unwrap_or(0)));
            out.insert("upcomingAppointments".to_string(), json!(util::query_all(&conn, "SELECT a.*, p.name AS patient_name FROM appointments a JOIN patients p ON p.id = a.patient_id WHERE a.appt_date >= ?1 AND a.status IN ('Scheduled','Confirmed') ORDER BY a.appt_date, a.appt_time LIMIT 8", &[&today])?));
            out.insert("missedAppointments".to_string(), json!(conn.query_row("SELECT COUNT(*) FROM appointments WHERE appt_date < ?1 AND status IN ('Scheduled','Confirmed')", [&today], |r| r.get::<_, i64>(0)).unwrap_or(0)));
            out.insert("appointmentTrend".to_string(), json!(util::query_all(&conn, "SELECT appt_date AS d, COUNT(*) AS n FROM appointments WHERE appt_date >= date(?1, '-13 days') GROUP BY appt_date ORDER BY appt_date", &[&today])?));
        }
        if can("queue.manage") {
            out.insert("queueWaiting".to_string(), json!(conn.query_row("SELECT COUNT(*) FROM queue_entries WHERE queue_date = ?1 AND status IN ('waiting','called','hold')", [&today], |r| r.get::<_, i64>(0)).unwrap_or(0)));
            out.insert("queueNow".to_string(), json!(util::query_all(&conn, "SELECT q.*, p.name AS patient_name FROM queue_entries q JOIN patients p ON p.id = q.patient_id WHERE q.queue_date = ?1 AND q.status IN ('waiting','called','in_progress') ORDER BY q.queue_no LIMIT 6", &[&today])?));
        }
        if can("clinical.view") {
            out.insert("completedVisits".to_string(), json!(conn.query_row("SELECT COUNT(*) FROM visits WHERE visit_date = ?1", [&today], |r| r.get::<_, i64>(0)).unwrap_or(0)));
            out.insert("treatmentSummary".to_string(), json!(util::query_all(&conn, "SELECT COALESCE(c.name, tr.custom_name) AS name, COUNT(*) AS n FROM treatment_records tr LEFT JOIN treatment_catalog c ON c.id = tr.treatment_id WHERE tr.treatment_date >= date(?1, '-30 days') GROUP BY name ORDER BY n DESC LIMIT 5", &[&today])?));
        }
        if can("payments.view") {
            out.insert("todayRevenue".to_string(), json!(conn.query_row("SELECT COALESCE(SUM(amount_paisa),0) FROM payments WHERE payment_date = ?1 AND reversed = 0", [&today], |r| r.get::<_, i64>(0)).unwrap_or(0)));
            out.insert("recentPayments".to_string(), json!(util::query_all(&conn, "SELECT p.receipt_no, p.amount_paisa, p.method, p.payment_date, pt.name AS patient_name FROM payments p JOIN patients pt ON pt.id = p.patient_id WHERE p.reversed = 0 ORDER BY p.id DESC LIMIT 8", params!())?));
            out.insert("revenueTrend".to_string(), json!(util::query_all(&conn, "SELECT payment_date AS d, SUM(amount_paisa) AS total FROM payments WHERE payment_date >= date(?1, '-13 days') AND reversed = 0 GROUP BY payment_date ORDER BY payment_date", &[&today])?));
        }
        if can("invoices.view") {
            out.insert("outstanding".to_string(), json!(conn.query_row("SELECT COALESCE(SUM(total_paisa - paid_paisa),0) FROM invoices WHERE status IN ('Due','Partially Paid')", (), |r| r.get::<_, i64>(0)).unwrap_or(0)));
        }
        if can("inventory.view") {
            let items = util::query_all(&conn, "SELECT i.name, i.reorder_level, COALESCE((SELECT SUM(qty_remaining) FROM inventory_batches b WHERE b.item_id = i.id),0) AS stock FROM inventory_items i WHERE i.active = 1", params!())?;
            let low: Vec<Value> = items.iter().filter(|r| r["stock"].as_i64().unwrap_or(0) <= r["reorder_level"].as_i64().unwrap_or(0)).cloned().collect();
            out.insert("lowStock".to_string(), json!(low.len()));
            out.insert("lowStockItems".to_string(), json!(low.into_iter().take(6).collect::<Vec<_>>()));
            let soon = (chrono::Local::now() + chrono::Duration::days(90)).format("%Y-%m-%d").to_string();
            out.insert("expiring".to_string(), json!(conn.query_row("SELECT COUNT(DISTINCT item_id) FROM inventory_batches WHERE qty_remaining > 0 AND expiry_date IS NOT NULL AND expiry_date <= ?1", [&soon], |r| r.get::<_, i64>(0)).unwrap_or(0)));
        }
        out.insert("unreadNotifications".to_string(), json!(conn.query_row("SELECT COUNT(*) FROM notifications WHERE is_read = 0", (), |r| r.get::<_, i64>(0)).unwrap_or(0)));
        Ok(json!(out))
    })()
    .map_err(err)
}

// ------------------------------------------------------------ search
#[tauri::command]
pub fn global_search(state: State<'_, AppState>, payload: Value) -> Result<Value, String> {
    (|| -> CmdResult<Value> {
        state.gate("global_search")?;
        let s = state.optional_session().ok_or_else(|| CmdError::new("UNAUTHENTICATED", "Please log in."))?;
        let q = payload.get("query").and_then(serde_json::Value::as_str).unwrap_or("").trim().to_string();
        if q.len() < 2 {
            return Ok(json!([]));
        }
        let can = |c: &str| s.permissions.iter().any(|p| p == "*" || p == c);
        let conn = state.conn.lock().unwrap();
        let like = format!("%{q}%");
        let mut results: Vec<Value> = Vec::new();
        if can("patients.view") {
            for p in util::query_all(&conn, "SELECT id, code, name, phone FROM patients WHERE name LIKE ?1 OR code LIKE ?1 OR phone LIKE ?1 ORDER BY id DESC LIMIT 8", &[&like])? {
                results.push(json!({ "kind": "Patient", "id": p["id"], "title": format!("{} ({})", p["name"].as_str().unwrap_or(""), p["code"].as_str().unwrap_or("")), "subtitle": p["phone"].as_str().unwrap_or(""), "route": format!("patients/{}", p["id"]) }));
            }
        }
        if can("appointments.view") {
            for r in util::query_all(&conn, "SELECT a.id, a.appt_date, a.status, p.name FROM appointments a JOIN patients p ON p.id = a.patient_id WHERE p.name LIKE ?1 ORDER BY a.appt_date DESC LIMIT 5", &[&like])? {
                results.push(json!({ "kind": "Appointment", "id": r["id"], "title": format!("{} — {}", r["name"].as_str().unwrap_or(""), r["appt_date"].as_str().unwrap_or("")), "subtitle": r["status"], "route": "appointments" }));
            }
        }
        if can("clinical.view") {
            for r in util::query_all(&conn, "SELECT v.id, v.visit_date, p.name FROM visits v JOIN patients p ON p.id = v.patient_id WHERE p.name LIKE ?1 OR v.diagnosis LIKE ?1 ORDER BY v.id DESC LIMIT 5", &[&like])? {
                results.push(json!({ "kind": "Visit", "id": r["id"], "title": format!("{} — visit {}", r["name"].as_str().unwrap_or(""), r["visit_date"].as_str().unwrap_or("")), "subtitle": "", "route": "patients" }));
            }
        }
        let fin_allowed = can("invoices.view") || can("payments.view") || can("reports.financial");
        if can("invoices.view") {
            for r in util::query_all(&conn, "SELECT i.id, i.invoice_no, p.name FROM invoices i JOIN patients p ON p.id = i.patient_id WHERE i.invoice_no LIKE ?1 OR p.name LIKE ?1 ORDER BY i.id DESC LIMIT 5", &[&like])? {
                results.push(json!({ "kind": "Invoice", "id": r["id"], "title": format!("Invoice {}", r["invoice_no"].as_str().unwrap_or("")), "subtitle": if fin_allowed { r["name"].as_str().unwrap_or("") } else { "" }, "route": "invoices" }));
            }
        }
        if can("payments.view") {
            for r in util::query_all(&conn, "SELECT p.id, p.receipt_no, pt.name FROM payments p JOIN patients pt ON pt.id = p.patient_id WHERE p.receipt_no LIKE ?1 ORDER BY p.id DESC LIMIT 5", &[&like])? {
                results.push(json!({ "kind": "Payment", "id": r["id"], "title": format!("Receipt {}", r["receipt_no"].as_str().unwrap_or("")), "subtitle": "", "route": "payments" }));
            }
        }
        if can("inventory.view") {
            for r in util::query_all(&conn, "SELECT id, sku, name FROM inventory_items WHERE name LIKE ?1 OR sku LIKE ?1 LIMIT 5", &[&like])? {
                results.push(json!({ "kind": "Inventory", "id": r["id"], "title": r["name"], "subtitle": r["sku"], "route": "inventory" }));
            }
        }
        if can("staff.view") {
            for r in util::query_all(&conn, "SELECT id, name, role_title FROM staff WHERE name LIKE ?1 LIMIT 5", &[&like])? {
                results.push(json!({ "kind": "Staff", "id": r["id"], "title": r["name"], "subtitle": r["role_title"], "route": "staff" }));
            }
        }
        results.truncate(30);
        Ok(json!(results))
    })()
    .map_err(err)
}

// ------------------------------------------------------------ notifications
pub fn refresh_system_notifications(state: &AppState) {
    // Phase 1: gather facts while holding the connection.
    let (appts, missed, low_names, low_count, exp, backup_due, backup_diff) = {
        let conn = state.conn.lock().unwrap();
        let today = util::today();
        let _ = conn.execute("DELETE FROM notifications WHERE category IN ('appointment','inventory','backup') AND is_read = 0", ());
        let appts: i64 = conn.query_row("SELECT COUNT(*) FROM appointments WHERE appt_date = ?1 AND status IN ('Scheduled','Confirmed')", [&today], |r| r.get(0)).unwrap_or(0);
        let missed: i64 = conn.query_row("SELECT COUNT(*) FROM appointments WHERE appt_date = date(?1, '-1 day') AND status IN ('Scheduled','Confirmed')", [&today], |r| r.get(0)).unwrap_or(0);
        let mut low_names: Vec<String> = Vec::new();
        let mut low_count = 0i64;
        if let Ok(items) = util::query_all(&conn, "SELECT i.id, i.name, i.reorder_level, COALESCE((SELECT SUM(qty_remaining) FROM inventory_batches b WHERE b.item_id = i.id),0) AS stock FROM inventory_items i WHERE i.active = 1", params!()) {
            let low: Vec<&Value> = items.iter().filter(|r| r["stock"].as_i64().unwrap_or(0) <= r["reorder_level"].as_i64().unwrap_or(0)).collect();
            low_count = low.len() as i64;
            low_names = low.iter().take(5).map(|r| r["name"].as_str().unwrap_or("").to_string()).collect();
        }
        let soon = (chrono::Local::now() + chrono::Duration::days(30))
            .format("%Y-%m-%d")
            .to_string();
        let exp: i64 = conn.query_row("SELECT COUNT(DISTINCT b.item_id) FROM inventory_batches b WHERE b.qty_remaining > 0 AND b.expiry_date IS NOT NULL AND b.expiry_date <= ?1", [&soon], |r| r.get(0)).unwrap_or(0);
        let days: i64 = util::setting(&conn, "auto_backup_days", "7")
            .parse()
            .unwrap_or(0);
        let last = util::setting(&conn, "last_auto_backup", "");
        let mut backup_due = false;
        let mut backup_diff = 0i64;
        if days > 0 {
            let last_date: String = last.chars().take(10).collect();
            let last_date = if last_date.len() == 10 {
                last_date
            } else {
                "2000-01-01".to_string()
            };
            let diff = chrono::NaiveDate::parse_from_str(&today, "%Y-%m-%d")
                .ok()
                .zip(chrono::NaiveDate::parse_from_str(&last_date, "%Y-%m-%d").ok())
                .map(|(t, l)| (t - l).num_days())
                .unwrap_or(0);
            backup_diff = diff;
            backup_due = diff >= days;
        }
        (
            appts,
            missed,
            low_names,
            low_count,
            exp,
            backup_due,
            backup_diff,
        )
    };
    // Phase 2: connection released; notify() re-locks it safely.
    if appts > 0 {
        state.notify(
            "info",
            "appointment",
            &format!("{appts} appointment(s) today"),
            "Review today\u{2019}s schedule and confirm arrivals.",
            Some("appointment"),
            None,
            Some("appointments"),
        );
    }
    if missed > 0 {
        state.notify(
            "warning",
            "appointment",
            &format!("{missed} missed appointment(s)"),
            "Yesterday\u{2019}s unconfirmed appointments need follow-up.",
            Some("appointment"),
            None,
            Some("appointments"),
        );
    }
    if low_count > 0 {
        state.notify(
            "warning",
            "inventory",
            &format!("{low_count} item(s) low on stock"),
            &low_names.join(", "),
            Some("inventory_item"),
            None,
            Some("inventory"),
        );
    }
    if exp > 0 {
        state.notify(
            "warning",
            "inventory",
            &format!("{exp} item(s) expiring soon"),
            "Check expiry dates and rotate stock.",
            Some("inventory_item"),
            None,
            Some("inventory"),
        );
    }
    if backup_due {
        state.notify(
            "warning",
            "backup",
            "Backup is due",
            &format!("No backup for {backup_diff} day(s). Run a backup now."),
            None,
            None,
            Some("backup"),
        );
    }
}

#[tauri::command]
pub fn notifications_list(state: State<'_, AppState>, payload: Value) -> Result<Value, String> {
    (|| -> CmdResult<Value> {
        state.gate("notifications_list")?;
        if state.optional_session().is_none() {
            return Err(CmdError::new("UNAUTHENTICATED", "Please log in."));
        }
        let conn = state.conn.lock().unwrap();
        let rows = if payload
            .get("unreadOnly")
            .and_then(serde_json::Value::as_bool)
            .unwrap_or(false)
        {
            util::query_all(
                &conn,
                "SELECT * FROM notifications WHERE is_read = 0 ORDER BY id DESC LIMIT 200",
                params!(),
            )?
        } else {
            util::query_all(
                &conn,
                "SELECT * FROM notifications ORDER BY id DESC LIMIT 200",
                params!(),
            )?
        };
        let unread: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM notifications WHERE is_read = 0",
                (),
                |r| r.get(0),
            )
            .unwrap_or(0);
        Ok(json!({ "rows": rows, "unread": unread }))
    })()
    .map_err(err)
}

#[tauri::command]
pub fn notifications_mark(state: State<'_, AppState>, payload: Value) -> Result<Value, String> {
    (|| -> CmdResult<Value> {
        state.gate("notifications_mark")?;
        if state.optional_session().is_none() {
            return Err(CmdError::new("UNAUTHENTICATED", "Please log in."));
        }
        let conn = state.conn.lock().unwrap();
        if payload
            .get("all")
            .and_then(serde_json::Value::as_bool)
            .unwrap_or(false)
        {
            conn.execute("UPDATE notifications SET is_read = 1", ())?;
        } else {
            let id = util::req_int(payload.get("id").unwrap_or(&Value::Null), "id", 1, i64::MAX)?;
            conn.execute("UPDATE notifications SET is_read = 1 WHERE id = ?1", [id])?;
        }
        Ok(json!({ "ok": true }))
    })()
    .map_err(err)
}

#[tauri::command]
pub fn notifications_clear(state: State<'_, AppState>) -> Result<Value, String> {
    (|| -> CmdResult<Value> {
        state.gate("notifications_clear")?;
        if state.optional_session().is_none() {
            return Err(CmdError::new("UNAUTHENTICATED", "Please log in."));
        }
        let conn = state.conn.lock().unwrap();
        conn.execute("DELETE FROM notifications WHERE is_read = 1", ())?;
        Ok(json!({ "ok": true }))
    })()
    .map_err(err)
}

#[tauri::command]
pub fn notifications_refresh(state: State<'_, AppState>) -> Result<Value, String> {
    (|| -> CmdResult<Value> {
        state.gate("notifications_refresh")?;
        refresh_system_notifications(&state);
        Ok(json!({ "ok": true }))
    })()
    .map_err(err)
}

// ------------------------------------------------------------ audit
#[tauri::command]
pub fn audit_list(state: State<'_, AppState>, payload: Value) -> Result<Value, String> {
    (|| -> CmdResult<Value> {
        state.gate("audit_list")?;
        state.need("audit.view")?;
        let conn = state.conn.lock().unwrap();
        let mut sql = String::from("SELECT * FROM audit_logs");
        let mut count_sql = String::from("SELECT COUNT(*) FROM audit_logs");
        let mut conds: Vec<String> = Vec::new();
        let mut args: Vec<String> = Vec::new();
        if let Some(f) = payload.get("from").and_then(serde_json::Value::as_str) {
            if !f.is_empty() {
                conds.push(format!("timestamp >= ?{}", args.len() + 1));
                args.push(f.to_string());
            }
        }
        if let Some(t) = payload.get("to").and_then(serde_json::Value::as_str) {
            if !t.is_empty() {
                conds.push(format!("timestamp <= ?{}", args.len() + 1));
                args.push(format!("{t}T23:59:59"));
            }
        }
        if let Some(u) = payload.get("userId").and_then(serde_json::Value::as_i64) {
            if u > 0 {
                conds.push(format!("user_id = {u}"));
            }
        }
        if let Some(a) = payload.get("action").and_then(serde_json::Value::as_str) {
            if !a.is_empty() {
                conds.push(format!("action LIKE ?{}", args.len() + 1));
                args.push(format!("%{a}%"));
            }
        }
        if let Some(q) = payload.get("search").and_then(serde_json::Value::as_str) {
            if !q.is_empty() {
                conds.push(format!(
                    "(summary LIKE ?{} OR username LIKE ?{})",
                    args.len() + 1,
                    args.len() + 1
                ));
                args.push(format!("%{q}%"));
            }
        }
        if !conds.is_empty() {
            let w = format!(" WHERE {}", conds.join(" AND "));
            sql.push_str(&w);
            count_sql.push_str(&w);
        }
        let page = payload
            .get("page")
            .and_then(serde_json::Value::as_i64)
            .unwrap_or(1)
            .max(1);
        let page_size = payload
            .get("pageSize")
            .and_then(serde_json::Value::as_i64)
            .unwrap_or(50)
            .clamp(10, 200);
        let refs: Vec<&dyn rusqlite::ToSql> =
            args.iter().map(|v| v as &dyn rusqlite::ToSql).collect();
        let total: i64 = conn
            .query_row(&count_sql, &refs[..], |r| r.get(0))
            .unwrap_or(0);
        sql.push_str(&format!(
            " ORDER BY id DESC LIMIT {page_size} OFFSET {}",
            (page - 1) * page_size
        ));
        let rows = util::query_all(&conn, &sql, &refs)?;
        Ok(json!({ "rows": rows, "total": total, "page": page, "pageSize": page_size }))
    })()
    .map_err(err)
}

// ------------------------------------------------------------ backup/restore
pub struct ParsedContainer {
    pub created_at: String,
    pub app_version: String,
    pub schema_version: i64,
    pub kind: String,
    pub clinic_name: String,
    pub files: Vec<Value>,
    pub db_base64: String,
    pub checksum_ok: bool,
}

pub fn parse_container(b64: &str) -> CmdResult<ParsedContainer> {
    use base64::Engine;
    let invalid = || {
        CmdError::new(
            "INVALID_BACKUP",
            "The selected file is not a valid Dentiva Pro backup.",
        )
    };
    let blob = base64::engine::general_purpose::STANDARD
        .decode(b64.as_bytes())
        .map_err(|_| invalid())?;
    let text = String::from_utf8(blob).map_err(|_| invalid())?;
    let c: Value = serde_json::from_str(&text).map_err(|_| invalid())?;
    if c["magic"].as_str().unwrap_or("") != "DENTIVABAK" || c["dbBase64"].as_str().is_none() {
        return Err(invalid());
    }
    let schema_version = c["schemaVersion"].as_i64().unwrap_or(0);
    if schema_version > db::SCHEMA_VERSION {
        return Err(CmdError::new("INCOMPATIBLE", format!("Backup schema v{schema_version} is newer than this app (v{}). Please update Dentiva Pro first.", db::SCHEMA_VERSION)));
    }
    let db_b64 = c["dbBase64"].as_str().unwrap_or("");
    let checksum_ok = sha256_hex_str(db_b64) == c["checksum"].as_str().unwrap_or("");
    Ok(ParsedContainer {
        created_at: c["createdAt"].as_str().unwrap_or("").to_string(),
        app_version: c["appVersion"].as_str().unwrap_or("").to_string(),
        schema_version,
        kind: c["kind"].as_str().unwrap_or("manual").to_string(),
        clinic_name: c["clinicName"].as_str().unwrap_or("").to_string(),
        files: c["files"].as_array().cloned().unwrap_or_default(),
        db_base64: db_b64.to_string(),
        checksum_ok,
    })
}

fn backup_filename(kind: &str) -> String {
    let clean = util::now_local().replace('T', "_").replace(':', "-");
    format!("DentivaPro_Backup_{clean}_{kind}.dentivabak")
}

fn snapshot_db_bytes(state: &AppState) -> CmdResult<Vec<u8>> {
    let tmp = state.paths.data_dir.join(format!(
        "backup-tmp-{}.db",
        chrono::Local::now().format("%Y%m%d%H%M%S%f")
    ));
    {
        let conn = state.conn.lock().unwrap();
        let _ = conn.execute_batch("PRAGMA wal_checkpoint(TRUNCATE);");
        let path_sql = tmp.to_string_lossy().replace('\'', "''");
        conn.execute_batch(&format!("VACUUM INTO '{path_sql}';"))?;
    }
    let bytes = std::fs::read(&tmp)?;
    let _ = std::fs::remove_file(&tmp);
    Ok(bytes)
}

pub fn run_backup(state: &AppState, kind: &str, location: &str) -> CmdResult<Value> {
    use base64::Engine;
    let s = state.need("backup.run")?;
    {
        let conn = state.conn.lock().unwrap();
        let chk: String = conn
            .query_row("PRAGMA integrity_check", (), |r| r.get(0))
            .unwrap_or_default();
        if chk != "ok" {
            return Err(CmdError::new("DB_CORRUPT", "Database integrity check failed. Backup aborted to avoid archiving a corrupt database."));
        }
    }
    let db_bytes = snapshot_db_bytes(state)?;
    let db_b64 = base64::engine::general_purpose::STANDARD.encode(&db_bytes);
    let conn = state.conn.lock().unwrap();
    let atts = util::query_all(
        &conn,
        "SELECT patient_id, stored_name, mime, original_name FROM patient_attachments",
        params!(),
    )?;
    let clinic_name: String = conn
        .query_row("SELECT name FROM clinic WHERE id = 1", (), |r| r.get(0))
        .unwrap_or_default();
    drop(conn);
    let mut files: Vec<Value> = Vec::new();
    let mut missing: Vec<String> = Vec::new();
    for t in &atts {
        let pid = t["patient_id"].as_i64().unwrap_or(0);
        let stored = t["stored_name"].as_str().unwrap_or("");
        let key = format!("p{pid}/{stored}");
        match std::fs::read(state.paths.attachments_dir.join(format!("p{pid}")).join(stored)) {
            Ok(bytes) => files.push(json!({ "key": key, "mime": t["mime"].as_str().unwrap_or(""), "name": t["original_name"].as_str().unwrap_or(""), "base64": base64::engine::general_purpose::STANDARD.encode(&bytes) })),
            Err(_) => missing.push(t["original_name"].as_str().unwrap_or("").to_string()),
        }
    }
    let container = json!({
        "magic": "DENTIVABAK", "format": 1, "appVersion": db::APP_VERSION, "schemaVersion": db::SCHEMA_VERSION,
        "createdAt": util::now_local(), "kind": kind, "installId": state.install_id, "clinicName": clinic_name,
        "checksum": sha256_hex_str(&db_b64), "dbBase64": db_b64, "files": files,
    });
    let blob = serde_json::to_vec(&container)?;
    let filename = backup_filename(kind);
    let size = blob.len();
    std::fs::create_dir_all(&state.paths.backups_dir)?;
    let dest = state.paths.backups_dir.join(&filename);
    std::fs::write(&dest, &blob)?;
    let conn = state.conn.lock().unwrap();
    conn.execute("INSERT INTO backup_records (filename, path, created_at, size_bytes, schema_version, app_version, kind, status, note, checksum) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10)",
        params![filename, if location.is_empty() { dest.to_string_lossy().to_string() } else { location.to_string() }, util::now_local(), size as i64, db::SCHEMA_VERSION, db::APP_VERSION, kind, "ok",
            if missing.is_empty() { String::new() } else { format!("Missing {} attachment file(s): {}", missing.len(), missing.iter().take(5).cloned().collect::<Vec<_>>().join(", ")) },
            sha256_hex_str(&db_b64)])?;
    let id = conn.last_insert_rowid();
    conn.execute(
        "UPDATE app_settings SET value = ?1 WHERE key = 'last_auto_backup'",
        params![util::now_local()],
    )?;
    drop(conn);
    state.audit(
        "backup.created",
        "backup",
        Some(id),
        &format!("Backup {filename} created ({} attachment(s))", files.len()),
        None,
        None,
    );
    state.notify(
        "success",
        "backup",
        "Backup completed",
        &format!("{filename} ({} KB).", size / 1024),
        Some("backup"),
        Some(id),
        Some("backup"),
    );
    let _ = s;
    Ok(
        json!({ "id": id, "filename": filename, "base64": base64::engine::general_purpose::STANDARD.encode(&blob), "sizeBytes": size, "missing": missing }),
    )
}

#[tauri::command]
pub fn backup_run(state: State<'_, AppState>, payload: Value) -> Result<Value, String> {
    (|| -> CmdResult<Value> {
        state.gate("backup_run")?;
        let kind = payload
            .get("kind")
            .and_then(serde_json::Value::as_str)
            .unwrap_or("manual");
        let location = payload
            .get("location")
            .and_then(serde_json::Value::as_str)
            .unwrap_or("");
        run_backup(&state, kind, location)
    })()
    .map_err(err)
}

#[tauri::command]
pub fn backup_list(state: State<'_, AppState>) -> Result<Value, String> {
    (|| -> CmdResult<Value> {
        state.gate("backup_list")?;
        state.need("backup.run")?;
        let conn = state.conn.lock().unwrap();
        util::query_all(
            &conn,
            "SELECT * FROM backup_records ORDER BY id DESC LIMIT 200",
            params!(),
        )
        .map(|v| json!(v))
    })()
    .map_err(err)
}

#[tauri::command]
pub fn restore_validate(state: State<'_, AppState>, payload: Value) -> Result<Value, String> {
    (|| -> CmdResult<Value> {
        state.gate("restore_validate")?;
        state.need("backup.restore")?;
        let parsed = parse_container(payload.get("base64").and_then(serde_json::Value::as_str).unwrap_or(""))?;
        Ok(json!({ "filename": payload.get("filename").and_then(serde_json::Value::as_str).unwrap_or(""), "createdAt": parsed.created_at, "appVersion": parsed.app_version,
            "schemaVersion": parsed.schema_version, "kind": parsed.kind, "clinicName": parsed.clinic_name, "attachments": parsed.files.len(), "checksumOk": parsed.checksum_ok }))
    })()
    .map_err(err)
}

#[tauri::command]
pub fn restore_run(state: State<'_, AppState>, payload: Value) -> Result<Value, String> {
    (|| -> CmdResult<Value> {
        state.gate("restore_run")?;
        let s = state.need("backup.restore")?;
        if payload.get("typed").and_then(serde_json::Value::as_str).unwrap_or("") != "RESTORE" {
            return Err(CmdError::new("CONFIRM", "Type RESTORE to confirm."));
        }
        let parsed = parse_container(payload.get("base64").and_then(serde_json::Value::as_str).unwrap_or(""))?;
        if !parsed.checksum_ok {
            return Err(CmdError::new("CHECKSUM", "Backup checksum mismatch. The file may be corrupted. Restore aborted."));
        }
        use base64::Engine;
        let db_bytes = base64::engine::general_purpose::STANDARD.decode(parsed.db_base64.as_bytes())?;
        // Validate the incoming DB before touching the live one.
        {
            let tmp = state.paths.data_dir.join(format!("restore-check-{}.db", chrono::Local::now().format("%Y%m%d%H%M%S%f")));
            std::fs::write(&tmp, &db_bytes)?;
            let check = (|| -> CmdResult<()> {
                let c = rusqlite::Connection::open(&tmp).map_err(|_| CmdError::new("INVALID_BACKUP", "Backup database payload is unreadable. Current data is untouched."))?;
                let chk: String = c.query_row("PRAGMA integrity_check", (), |r| r.get(0)).unwrap_or_default();
                if chk != "ok" {
                    return Err(CmdError::new("INVALID_BACKUP", "Backup failed integrity check. Current data is untouched."));
                }
                let has: i64 = c.query_row("SELECT COUNT(*) FROM sqlite_master WHERE type = 'table' AND name = 'patients'", (), |r| r.get(0)).unwrap_or(0);
                if has == 0 {
                    return Err(CmdError::new("INVALID_BACKUP", "Backup is missing core tables. Current data is untouched."));
                }
                Ok(())
            })();
            let _ = std::fs::remove_file(&tmp);
            check?;
        }
        // Mandatory pre-restore backup.
        let pre = run_backup(&state, "pre-restore", "")?;
        let pre_filename = pre["filename"].as_str().unwrap_or("").to_string();
        // Swap: replace the live DB file, then reopen.
        {
            let mut guard = state.conn.lock().unwrap();
            let _ = guard.execute_batch("PRAGMA wal_checkpoint(TRUNCATE);");
            let _ = std::mem::replace(&mut *guard, db::open_connection(&state.paths.db_path.with_extension("tmp-swap"))?);
        }
        std::fs::write(&state.paths.db_path, &db_bytes)?;
        let _ = std::fs::remove_file(state.paths.db_path.with_extension("tmp-swap"));
        let _ = std::fs::remove_file(format!("{}-wal", state.paths.db_path.to_string_lossy()));
        let _ = std::fs::remove_file(format!("{}-shm", state.paths.db_path.to_string_lossy()));
        {
            let fresh = db::open_connection(&state.paths.db_path)?;
            let mut guard = state.conn.lock().unwrap();
            let _ = std::mem::replace(&mut *guard, fresh);
        }
        // Restore attachment files (wipe current set first, like the fallback).
        let _ = std::fs::remove_dir_all(&state.paths.attachments_dir);
        std::fs::create_dir_all(&state.paths.attachments_dir)?;
        for f in &parsed.files {
            let key = f["key"].as_str().unwrap_or("");
            let mut parts = key.splitn(2, '/');
            let (dir, name) = (parts.next().unwrap_or(""), parts.next().unwrap_or(""));
            if dir.is_empty() || name.is_empty() || dir.contains("..") || name.contains("..") || name.contains('/') || name.contains('\\') {
                continue;
            }
            let safe = util::safe_filename(name);
            if let Ok(bytes) = base64::engine::general_purpose::STANDARD.decode(f["base64"].as_str().unwrap_or("").as_bytes()) {
                let _ = std::fs::create_dir_all(state.paths.attachments_dir.join(dir));
                let _ = std::fs::write(state.paths.attachments_dir.join(dir).join(&safe), &bytes);
            }
        }
        let conn = state.conn.lock().unwrap();
        let user_ok: i64 = conn.query_row("SELECT COUNT(*) FROM users WHERE id = ?1", [s.id], |r| r.get(0)).unwrap_or(0);
        conn.execute("INSERT INTO restore_records (source_filename, restored_at, status, note, pre_restore_backup_id, performed_by) VALUES (?1, ?2, 'ok', ?3, NULL, ?4)",
            params![payload.get("filename").and_then(serde_json::Value::as_str).unwrap_or("backup"), util::now_local(),
                format!("Restored {} attachment(s); pre-restore safety backup: {pre_filename}", parsed.files.len()),
                if user_ok > 0 { Some(s.id) } else { None }])?;
        let id = conn.last_insert_rowid();
        drop(conn);
        state.audit("restore.completed", "restore", Some(id), &format!("Database restored from {}", payload.get("filename").and_then(serde_json::Value::as_str).unwrap_or("backup")), None, None);
        state.notify("success", "backup", "Restore completed", &format!("Data restored from {}. A pre-restore safety backup was kept.", payload.get("filename").and_then(serde_json::Value::as_str).unwrap_or("backup")), Some("restore"), Some(id), Some("backup"));
        Ok(json!({ "ok": true, "preRestoreId": pre["id"] }))
    })()
    .map_err(err)
}

// ------------------------------------------------------------ reports
#[tauri::command]
pub fn report_run(state: State<'_, AppState>, payload: Value) -> Result<Value, String> {
    (|| -> CmdResult<Value> {
        state.gate("report_run")?;
        let rtype = payload.get("type").and_then(serde_json::Value::as_str).unwrap_or("");
        let from = payload.get("from").and_then(serde_json::Value::as_str).unwrap_or("2000-01-01");
        let to = payload.get("to").and_then(serde_json::Value::as_str).unwrap_or("2100-01-01");
        let conn = state.conn.lock().unwrap();
        let sum = |rows: &[Value], key: &str| -> i64 { rows.iter().map(|r| r[key].as_i64().unwrap_or(0)).sum() };
        match rtype {
            "registrations" => {
                state.need("reports.view")?;
                let rows = util::query_all(&conn, "SELECT reg_date AS d, COUNT(*) AS n FROM patients WHERE reg_date BETWEEN ?1 AND ?2 GROUP BY reg_date ORDER BY reg_date", &[&from, &to])?;
                Ok(json!({ "columns": ["Date", "Registrations"], "rows": rows, "total": sum(&rows, "n") }))
            }
            "visits" => {
                state.need("reports.view")?;
                let rows = util::query_all(&conn, "SELECT v.visit_date, p.code, p.name, COALESCE(dt.name,'') AS dentist, v.diagnosis FROM visits v JOIN patients p ON p.id = v.patient_id LEFT JOIN dentists dt ON dt.id = v.dentist_id WHERE v.visit_date BETWEEN ?1 AND ?2 ORDER BY v.visit_date DESC LIMIT 2000", &[&from, &to])?;
                Ok(json!({ "columns": ["Date", "Code", "Patient", "Dentist", "Diagnosis"], "rows": rows, "total": rows.len() }))
            }
            "appointments" => {
                state.need("reports.view")?;
                let rows = util::query_all(&conn, "SELECT a.appt_date, a.appt_time, p.code, p.name, COALESCE(dt.name,'') AS dentist, a.status FROM appointments a JOIN patients p ON p.id = a.patient_id LEFT JOIN dentists dt ON dt.id = a.dentist_id WHERE a.appt_date BETWEEN ?1 AND ?2 ORDER BY a.appt_date, a.appt_time LIMIT 2000", &[&from, &to])?;
                Ok(json!({ "columns": ["Date", "Time", "Code", "Patient", "Dentist", "Status"], "rows": rows, "total": rows.len() }))
            }
            "treatments" => {
                state.need("reports.view")?;
                let rows = util::query_all(&conn, "SELECT COALESCE(c.name, tr.custom_name) AS name, COUNT(*) AS n, SUM(tr.price_paisa * tr.qty) AS amount FROM treatment_records tr LEFT JOIN treatment_catalog c ON c.id = tr.treatment_id WHERE tr.treatment_date BETWEEN ?1 AND ?2 GROUP BY name ORDER BY n DESC", &[&from, &to])?;
                Ok(json!({ "columns": ["Treatment", "Count", "Amount (paisa)"], "rows": rows, "total": rows.len() }))
            }
            "prescriptions" => {
                state.need("reports.view")?;
                let rows = util::query_all(&conn, "SELECT r.prescription_date, p.code, p.name, (SELECT COUNT(*) FROM prescription_items i WHERE i.prescription_id = r.id) AS items FROM prescriptions r JOIN patients p ON p.id = r.patient_id WHERE r.prescription_date BETWEEN ?1 AND ?2 ORDER BY r.prescription_date DESC LIMIT 2000", &[&from, &to])?;
                Ok(json!({ "columns": ["Date", "Code", "Patient", "Items"], "rows": rows, "total": rows.len() }))
            }
            "invoices" => {
                state.need("reports.financial")?;
                let rows = util::query_all(&conn, "SELECT i.invoice_no, i.invoice_date, p.code, p.name, i.total_paisa, i.paid_paisa, (i.total_paisa - i.paid_paisa) AS due, i.status FROM invoices i JOIN patients p ON p.id = i.patient_id WHERE i.invoice_date BETWEEN ?1 AND ?2 ORDER BY i.invoice_date DESC LIMIT 2000", &[&from, &to])?;
                Ok(json!({ "columns": ["Invoice", "Date", "Code", "Patient", "Total", "Paid", "Due", "Status"], "rows": rows, "total": sum(&rows, "total_paisa") }))
            }
            "payments" => {
                state.need("reports.financial")?;
                let rows = util::query_all(&conn, "SELECT py.receipt_no, py.payment_date, p.code, p.name, py.amount_paisa, py.method FROM payments py JOIN patients p ON p.id = py.patient_id WHERE py.payment_date BETWEEN ?1 AND ?2 AND py.reversed = 0 ORDER BY py.payment_date DESC LIMIT 2000", &[&from, &to])?;
                Ok(json!({ "columns": ["Receipt", "Date", "Code", "Patient", "Amount", "Method"], "rows": rows, "total": sum(&rows, "amount_paisa") }))
            }
            "outstanding" => {
                state.need("reports.financial")?;
                let rows = util::query_all(&conn, "SELECT i.invoice_no, i.invoice_date, p.code, p.name, p.phone, (i.total_paisa - i.paid_paisa) AS due FROM invoices i JOIN patients p ON p.id = i.patient_id WHERE i.status IN ('Due','Partially Paid') ORDER BY i.invoice_date LIMIT 2000", params!())?;
                Ok(json!({ "columns": ["Invoice", "Date", "Code", "Patient", "Phone", "Due"], "rows": rows, "total": sum(&rows, "due") }))
            }
            "inventory" => {
                state.need("inventory.view")?;
                let rows = util::query_all(&conn, "SELECT i.sku, i.name, i.category, COALESCE((SELECT SUM(qty_remaining) FROM inventory_batches b WHERE b.item_id = i.id),0) AS stock, i.reorder_level, i.unit FROM inventory_items i ORDER BY i.name", params!())?;
                Ok(json!({ "columns": ["SKU", "Item", "Category", "Stock", "Reorder", "Unit"], "rows": rows, "total": rows.len() }))
            }
            "expiry" => {
                state.need("inventory.view")?;
                let rows = util::query_all(&conn, "SELECT i.sku, i.name, b.batch_no, b.expiry_date, b.qty_remaining FROM inventory_batches b JOIN inventory_items i ON i.id = b.item_id WHERE b.qty_remaining > 0 AND b.expiry_date IS NOT NULL ORDER BY b.expiry_date LIMIT 2000", params!())?;
                Ok(json!({ "columns": ["SKU", "Item", "Batch", "Expiry", "Qty"], "rows": rows, "total": rows.len() }))
            }
            "expenses" => {
                state.need("reports.financial")?;
                let rows = util::query_all(&conn, "SELECT e.expense_date, COALESCE(c.name,'—') AS category, e.amount_paisa, e.method, e.note FROM expenses e LEFT JOIN accounting_categories c ON c.id = e.category_id WHERE e.expense_date BETWEEN ?1 AND ?2 ORDER BY e.expense_date DESC", &[&from, &to])?;
                Ok(json!({ "columns": ["Date", "Category", "Amount", "Method", "Note"], "rows": rows, "total": sum(&rows, "amount_paisa") }))
            }
            "income" => {
                state.need("reports.financial")?;
                let rows = util::query_all(&conn, "SELECT e.income_date, COALESCE(c.name,'—') AS category, e.amount_paisa, e.method, e.note FROM income_records e LEFT JOIN accounting_categories c ON c.id = e.category_id WHERE e.income_date BETWEEN ?1 AND ?2 ORDER BY e.income_date DESC", &[&from, &to])?;
                Ok(json!({ "columns": ["Date", "Category", "Amount", "Method", "Note"], "rows": rows, "total": sum(&rows, "amount_paisa") }))
            }
            "profit" => {
                state.need("reports.financial")?;
                let inc: i64 = conn.query_row("SELECT COALESCE(SUM(amount_paisa),0) FROM income_records WHERE income_date BETWEEN ?1 AND ?2", params![from, to], |r| r.get(0)).unwrap_or(0);
                let exp: i64 = conn.query_row("SELECT COALESCE(SUM(amount_paisa),0) FROM expenses WHERE expense_date BETWEEN ?1 AND ?2", params![from, to], |r| r.get(0)).unwrap_or(0);
                let pay: i64 = conn.query_row("SELECT COALESCE(SUM(amount_paisa),0) FROM payments WHERE payment_date BETWEEN ?1 AND ?2 AND reversed = 0", params![from, to], |r| r.get(0)).unwrap_or(0);
                Ok(json!({ "columns": ["Metric", "Amount (paisa)"],
                    "rows": [json!({"Metric": "Clinical collections", "Amount (paisa)": pay}), json!({"Metric": "Other income", "Amount (paisa)": inc}), json!({"Metric": "Expenses", "Amount (paisa)": exp}), json!({"Metric": "Net", "Amount (paisa)": pay + inc - exp})],
                    "total": pay + inc - exp }))
            }
            "dentist_activity" => {
                state.need("reports.view")?;
                let rows = util::query_all(&conn, "SELECT COALESCE(dt.name,'—') AS dentist, (SELECT COUNT(*) FROM visits v WHERE v.dentist_id = dt.id AND v.visit_date BETWEEN ?1 AND ?2) AS visits, (SELECT COUNT(*) FROM appointments a WHERE a.dentist_id = dt.id AND a.appt_date BETWEEN ?1 AND ?2) AS appointments FROM dentists dt ORDER BY dentist", &[&from, &to, &from, &to])?;
                Ok(json!({ "columns": ["Dentist", "Visits", "Appointments"], "rows": rows, "total": rows.len() }))
            }
            "audit" => {
                state.need("audit.view")?;
                let rows = util::query_all(&conn, "SELECT timestamp, username, action, entity_type, summary FROM audit_logs WHERE timestamp BETWEEN ?1 AND ?2 ORDER BY id DESC LIMIT 2000", &[&format!("{from}T00:00:00"), &format!("{to}T23:59:59")])?;
                Ok(json!({ "columns": ["Time", "User", "Action", "Entity", "Summary"], "rows": rows, "total": rows.len() }))
            }
            _ => Err(CmdError::new("VALIDATION", "Unknown report type.")),
        }
    })()
    .map_err(err)
}

// ------------------------------------------------------------ export
fn to_csv(columns: &[String], rows: &[Value]) -> String {
    let esc = |v: &Value| -> String {
        let s = match v {
            Value::Null => String::new(),
            Value::String(x) => x.clone(),
            other => other.to_string(),
        };
        if s.contains(['"', ',', '\n']) {
            format!("\"{}\"", s.replace('"', "\"\""))
        } else {
            s
        }
    };
    let keys: Vec<String> = if rows.is_empty() {
        columns.to_vec()
    } else {
        rows[0]
            .as_object()
            .map(|o| o.keys().cloned().collect())
            .unwrap_or_default()
    };
    let head: Vec<String> = if columns.is_empty() {
        keys.clone()
    } else {
        columns.to_vec()
    };
    let mut lines = vec![head
        .iter()
        .map(|h| esc(&json!(h)))
        .collect::<Vec<_>>()
        .join(",")];
    for r in rows {
        lines.push(
            keys.iter()
                .map(|k| esc(&r[k]))
                .collect::<Vec<_>>()
                .join(","),
        );
    }
    format!("\u{FEFF}{}", lines.join("\n"))
}

pub fn run_report_query(
    state: &AppState,
    rtype: &str,
    from: &str,
    to: &str,
) -> CmdResult<(Vec<String>, Vec<Value>)> {
    let conn = state.conn.lock().unwrap();
    match rtype {
        "expenses" => {
            state.need("reports.financial")?;
            let rows = util::query_all(&conn, "SELECT e.expense_date, COALESCE(c.name,'—') AS category, e.amount_paisa, e.method, e.note FROM expenses e LEFT JOIN accounting_categories c ON c.id = e.category_id WHERE e.expense_date BETWEEN ?1 AND ?2 ORDER BY e.expense_date DESC", &[&from, &to])?;
            Ok((
                vec![
                    "Date".into(),
                    "Category".into(),
                    "Amount".into(),
                    "Method".into(),
                    "Note".into(),
                ],
                rows,
            ))
        }
        "invoices" => {
            state.need("reports.financial")?;
            let rows = util::query_all(&conn, "SELECT i.invoice_no, i.invoice_date, p.code, p.name, i.total_paisa, i.paid_paisa, (i.total_paisa - i.paid_paisa) AS due, i.status FROM invoices i JOIN patients p ON p.id = i.patient_id WHERE i.invoice_date BETWEEN ?1 AND ?2 ORDER BY i.invoice_date DESC LIMIT 2000", &[&from, &to])?;
            Ok((
                vec![
                    "Invoice".into(),
                    "Date".into(),
                    "Code".into(),
                    "Patient".into(),
                    "Total".into(),
                    "Paid".into(),
                    "Due".into(),
                    "Status".into(),
                ],
                rows,
            ))
        }
        "payments" => {
            state.need("reports.financial")?;
            let rows = util::query_all(&conn, "SELECT py.receipt_no, py.payment_date, p.code, p.name, py.amount_paisa, py.method FROM payments py JOIN patients p ON p.id = py.patient_id WHERE py.payment_date BETWEEN ?1 AND ?2 AND py.reversed = 0 ORDER BY py.payment_date DESC LIMIT 2000", &[&from, &to])?;
            Ok((
                vec![
                    "Receipt".into(),
                    "Date".into(),
                    "Code".into(),
                    "Patient".into(),
                    "Amount".into(),
                    "Method".into(),
                ],
                rows,
            ))
        }
        "inventory" => {
            state.need("inventory.view")?;
            let rows = util::query_all(&conn, "SELECT i.sku, i.name, i.category, COALESCE((SELECT SUM(qty_remaining) FROM inventory_batches b WHERE b.item_id = i.id),0) AS stock, i.reorder_level, i.unit FROM inventory_items i ORDER BY i.name", params!())?;
            Ok((
                vec![
                    "SKU".into(),
                    "Item".into(),
                    "Category".into(),
                    "Stock".into(),
                    "Reorder".into(),
                    "Unit".into(),
                ],
                rows,
            ))
        }
        "appointments" => {
            state.need("appointments.view")?;
            let rows = util::query_all(&conn, "SELECT a.appt_date, a.appt_time, p.code, p.name, COALESCE(dt.name,'') AS dentist, a.status FROM appointments a JOIN patients p ON p.id = a.patient_id LEFT JOIN dentists dt ON dt.id = a.dentist_id WHERE a.appt_date BETWEEN ?1 AND ?2 ORDER BY a.appt_date, a.appt_time LIMIT 2000", &[&from, &to])?;
            Ok((
                vec![
                    "Date".into(),
                    "Time".into(),
                    "Code".into(),
                    "Patient".into(),
                    "Dentist".into(),
                    "Status".into(),
                ],
                rows,
            ))
        }
        "audit" => {
            state.need("audit.view")?;
            let rows = util::query_all(&conn, "SELECT timestamp, username, action, entity_type, summary FROM audit_logs WHERE timestamp BETWEEN ?1 AND ?2 ORDER BY id DESC LIMIT 2000", &[&format!("{from}T00:00:00"), &format!("{to}T23:59:59")])?;
            Ok((
                vec![
                    "Time".into(),
                    "User".into(),
                    "Action".into(),
                    "Entity".into(),
                    "Summary".into(),
                ],
                rows,
            ))
        }
        _ => Err(CmdError::new("VALIDATION", "Unknown report type.")),
    }
}

#[tauri::command]
pub fn data_export(state: State<'_, AppState>, payload: Value) -> Result<Value, String> {
    (|| -> CmdResult<Value> {
        state.gate("data_export")?;
        let module = payload.get("module").and_then(serde_json::Value::as_str).unwrap_or("");
        let format = payload.get("format").and_then(serde_json::Value::as_str).unwrap_or("csv");
        let from = payload.get("from").and_then(serde_json::Value::as_str).unwrap_or("2000-01-01");
        let to = payload.get("to").and_then(serde_json::Value::as_str).unwrap_or("2100-01-01");
        let (columns, rows): (Vec<String>, Vec<Value>) = if module == "patients" {
            state.need("patients.export")?;
            let conn = state.conn.lock().unwrap();
            let rows = util::query_all(&conn, "SELECT code, name, gender, dob, phone, address, reg_date, status FROM patients WHERE reg_date BETWEEN ?1 AND ?2 ORDER BY id", &[&from, &to])?;
            (vec!["Code".into(), "Name".into(), "Gender".into(), "DOB".into(), "Phone".into(), "Address".into(), "Registered".into(), "Status".into()], rows)
        } else if module == "invoices" || module == "payments" || module == "accounting" {
            state.need("reports.financial")?;
            let rt = if module == "accounting" { "expenses" } else { module };
            run_report_query(&state, rt, from, to)?
        } else if module == "inventory" {
            state.need("inventory.view")?;
            run_report_query(&state, "inventory", from, to)?
        } else if module == "appointments" {
            state.need("appointments.view")?;
            run_report_query(&state, "appointments", from, to)?
        } else if module == "audit" {
            state.need("audit.view")?;
            run_report_query(&state, "audit", from, to)?
        } else {
            return Err(CmdError::new("VALIDATION", "Unknown export module."));
        };
        let filename = format!("DentivaPro_{module}_{from}_to_{to}.{}", if format == "json" { "json" } else { "csv" });
        let content = if format == "json" {
            serde_json::to_string_pretty(&json!({ "module": module, "from": from, "to": to, "exportedAt": util::now_local(), "rows": rows }))?
        } else {
            to_csv(&columns, &rows)
        };
        use base64::Engine;
        let count = rows.len();
        state.audit("data.exported", "export", None, &format!("{module} exported ({count} row(s), {format})"), None, None);
        Ok(json!({ "filename": filename, "base64": base64::engine::general_purpose::STANDARD.encode(content.as_bytes()), "count": count }))
    })()
    .map_err(err)
}

// ------------------------------------------------------------ reset / logo
#[tauri::command]
pub fn data_reset(state: State<'_, AppState>, payload: Value) -> Result<Value, String> {
    (|| -> CmdResult<Value> {
        state.gate("data_reset")?;
        state.need("data.danger")?;
        if payload
            .get("typed")
            .and_then(serde_json::Value::as_str)
            .unwrap_or("")
            != "DELETE ALL DATA"
        {
            return Err(CmdError::new("CONFIRM", "Type DELETE ALL DATA to confirm."));
        }
        run_backup(&state, "pre-reset", "")?;
        {
            let mut guard = state.conn.lock().unwrap();
            let _ = std::mem::replace(
                &mut *guard,
                db::open_connection(&state.paths.db_path.with_extension("tmp-swap"))?,
            );
        }
        let _ = std::fs::remove_file(&state.paths.db_path);
        let _ = std::fs::remove_file(format!("{}-wal", state.paths.db_path.to_string_lossy()));
        let _ = std::fs::remove_file(format!("{}-shm", state.paths.db_path.to_string_lossy()));
        let _ = std::fs::remove_file(state.paths.db_path.with_extension("tmp-swap"));
        let fresh = db::open_connection(&state.paths.db_path)?;
        db::ensure_schema(&fresh)?;
        // Preserve activation across factory reset (one-time code stays valid).
        util::meta_set(&fresh, "activated", "1")?;
        util::meta_set(
            &fresh,
            "activation_receipt",
            &crate::activation::activation_receipt(&state.install_id),
        )?;
        {
            let mut guard = state.conn.lock().unwrap();
            let _ = std::mem::replace(&mut *guard, fresh);
        }
        let _ = std::fs::remove_dir_all(&state.paths.attachments_dir);
        let _ = std::fs::remove_file(state.paths.data_dir.join("logo"));
        *state.session.lock().unwrap() = None;
        *state.locked.lock().unwrap() = false;
        Ok(json!({ "ok": true }))
    })()
    .map_err(err)
}

#[tauri::command]
pub fn logo_save(state: State<'_, AppState>, payload: Value) -> Result<Value, String> {
    (|| -> CmdResult<Value> {
        state.gate("logo_save")?;
        state.need("settings.manage")?;
        let b64 = payload
            .get("base64")
            .and_then(serde_json::Value::as_str)
            .unwrap_or("");
        let mime = payload
            .get("mime")
            .and_then(serde_json::Value::as_str)
            .unwrap_or("");
        if !["image/png", "image/jpeg", "image/webp", "image/svg+xml"].contains(&mime) {
            return Err(CmdError::new(
                "VALIDATION",
                "Logo must be PNG, JPEG, WebP, or SVG.",
            ));
        }
        use base64::Engine;
        let bytes = base64::engine::general_purpose::STANDARD.decode(b64.as_bytes())?;
        if bytes.len() > 5 * 1024 * 1024 {
            return Err(CmdError::new("VALIDATION", "Logo exceeds 5 MB."));
        }
        std::fs::write(state.paths.data_dir.join("logo"), &bytes)?;
        let logo_path = format!("file:logo:{mime}");
        let conn = state.conn.lock().unwrap();
        conn.execute(
            "UPDATE clinic SET logo_path = ?1 WHERE id = 1",
            [&logo_path],
        )?;
        Ok(json!({ "ok": true, "logoPath": logo_path }))
    })()
    .map_err(err)
}

#[tauri::command]
pub fn logo_get(state: State<'_, AppState>) -> Result<Value, String> {
    (|| -> CmdResult<Value> {
        state.gate("logo_get")?;
        let conn = state.conn.lock().unwrap();
        let lp: String = conn.query_row("SELECT logo_path FROM clinic WHERE id = 1", (), |r| r.get(0)).unwrap_or_default();
        if !lp.starts_with("file:") {
            return Ok(json!({ "base64": "", "mime": "" }));
        }
        let mime = lp.split(':').nth(2).unwrap_or("").to_string();
        use base64::Engine;
        match std::fs::read(state.paths.data_dir.join("logo")) {
            Ok(bytes) => Ok(json!({ "base64": base64::engine::general_purpose::STANDARD.encode(&bytes), "mime": mime })),
            Err(_) => Ok(json!({ "base64": "", "mime": "" })),
        }
    })()
    .map_err(err)
}
