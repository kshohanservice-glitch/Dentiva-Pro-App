// Dentiva Pro — staff/users/roles/clinic/dentists/printers (native backend).

use rusqlite::params;
use serde_json::{json, Value};
use tauri::State;

use crate::ctx::AppState;
use crate::error::{CmdError, CmdResult};
use crate::util;

fn err(e: CmdError) -> String {
    e.to_string()
}

fn valid_username(u: &str) -> bool {
    u.len() >= 3 && u.len() <= 32 && u.chars().all(|c| c.is_ascii_alphanumeric() || c == '.' || c == '_' || c == '-')
}

// ------------------------------------------------------------ staff
#[tauri::command]
pub fn staff_list(state: State<'_, AppState>, payload: Value) -> Result<Value, String> {
    (|| -> CmdResult<Value> {
        state.gate("staff_list")?;
        state.need("staff.view")?;
        let can_manage = state.optional_session().map(|s| s.permissions.iter().any(|p| p == "*" || p == "staff.manage")).unwrap_or(false);
        let conn = state.conn.lock().unwrap();
        let q = payload.get("search").and_then(serde_json::Value::as_str).unwrap_or("").trim().to_string();
        let rows = if q.is_empty() {
            util::query_all(&conn, "SELECT * FROM staff ORDER BY name", params!())?
        } else {
            let like = format!("%{q}%");
            util::query_all(&conn, "SELECT * FROM staff WHERE name LIKE ?1 OR phone LIKE ?1 OR role_title LIKE ?1 ORDER BY name", &[&like])?
        };
        if can_manage {
            Ok(json!(rows))
        } else {
            let redacted: Vec<Value> = rows.into_iter().map(|mut r| {
                r["salary_paisa"] = Value::Null;
                r["nid_no"] = json!("");
                r["address"] = json!("");
                r
            }).collect();
            Ok(json!(redacted))
        }
    })()
    .map_err(err)
}

#[tauri::command]
pub fn staff_save(state: State<'_, AppState>, payload: Value) -> Result<Value, String> {
    (|| -> CmdResult<Value> {
        state.gate("staff_save")?;
        state.need("staff.manage")?;
        let name = util::req_text(payload.get("name").unwrap_or(&Value::Null), "Staff name", 160)?;
        let salary = util::req_money(payload.get("salaryPaisa").unwrap_or(&Value::Null), "salary")?;
        let conn = state.conn.lock().unwrap();
        let g = |k: &str, m: usize| util::opt_text(payload.get(k).unwrap_or(&Value::Null), m);
        let dob: Option<String> = payload.get("dob").and_then(serde_json::Value::as_str).filter(|s| !s.is_empty()).map(ToString::to_string);
        let joining: Option<String> = payload.get("joiningDate").and_then(serde_json::Value::as_str).filter(|s| !s.is_empty()).map(ToString::to_string);
        let active = if payload.get("active").and_then(serde_json::Value::as_bool).unwrap_or(true) { 1 } else { 0 };
        if let Some(id) = util::opt_id(payload.get("id").unwrap_or(&Value::Null)) {
            conn.execute("UPDATE staff SET name = ?1, dob = ?2, gender = ?3, address = ?4, phone = ?5, emergency_contact = ?6, emergency_phone = ?7, blood_group = ?8, nid_no = ?9, role_title = ?10, department = ?11, joining_date = ?12, salary_paisa = ?13, notes = ?14, active = ?15, updated_at = ?16 WHERE id = ?17",
                params![name, dob, g("gender", 16), g("address", 500), g("phone", 48), g("emergency_contact", 120), g("emergency_phone", 48),
                    g("blood_group", 16), g("nid_no", 64), g("role_title", 120), g("department", 120), joining, salary, g("notes", 4000), active, util::now_local(), id])?;
            drop(conn);
            state.audit("staff.updated", "staff", Some(id), &format!("Staff {name} updated"), None, Some(payload.to_string()));
            return Ok(json!({ "id": id }));
        }
        conn.execute("INSERT INTO staff (name, dob, gender, address, phone, emergency_contact, emergency_phone, blood_group, nid_no, role_title, department, joining_date, salary_paisa, notes, active, created_at, updated_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, 1, ?15, ?15)",
            params![name, dob, g("gender", 16), g("address", 500), g("phone", 48), g("emergency_contact", 120), g("emergency_phone", 48),
                g("blood_group", 16), g("nid_no", 64), g("role_title", 120), g("department", 120), joining, salary, g("notes", 4000), util::now_local()])?;
        let id = conn.last_insert_rowid();
        drop(conn);
        state.audit("staff.created", "staff", Some(id), &format!("Staff {name} created"), None, Some(payload.to_string()));
        Ok(json!({ "id": id }))
    })()
    .map_err(err)
}

#[tauri::command]
pub fn staff_delete(state: State<'_, AppState>, payload: Value) -> Result<Value, String> {
    (|| -> CmdResult<Value> {
        state.gate("staff_delete")?;
        state.need("staff.manage")?;
        let id = util::req_int(payload.get("id").unwrap_or(&Value::Null), "id", 1, i64::MAX)?;
        let conn = state.conn.lock().unwrap();
        conn.execute("DELETE FROM staff WHERE id = ?1", [id])?;
        drop(conn);
        state.audit("staff.deleted", "staff", Some(id), &format!("Staff #{id} deleted"), None, None);
        Ok(json!({ "id": id }))
    })()
    .map_err(err)
}

// ------------------------------------------------------------ users
#[tauri::command]
pub fn users_list(state: State<'_, AppState>) -> Result<Value, String> {
    (|| -> CmdResult<Value> {
        state.gate("users_list")?;
        state.need("users.manage")?;
        let conn = state.conn.lock().unwrap();
        util::query_all(&conn, "SELECT u.id, u.full_name, u.username, u.role_id, r.name AS role_name, u.active, u.last_login_at, u.created_at FROM users u JOIN roles r ON r.id = u.role_id ORDER BY u.username", params!()).map(|v| json!(v))
    })()
    .map_err(err)
}

#[tauri::command]
pub fn users_save(state: State<'_, AppState>, payload: Value) -> Result<Value, String> {
    (|| -> CmdResult<Value> {
        state.gate("users_save")?;
        state.need("users.manage")?;
        let username = util::req_text(payload.get("username").unwrap_or(&Value::Null), "username", 32)?;
        if !valid_username(&username) {
            return Err(CmdError::new("VALIDATION", "Username must be 3–32 chars (letters, digits, . _ -)."));
        }
        let role_id = util::req_int(payload.get("roleId").unwrap_or(&Value::Null), "roleId", 1, i64::MAX)?;
        let full_name = util::req_text(payload.get("fullName").unwrap_or(&Value::Null), "full name", 120)?;
        let conn = state.conn.lock().unwrap();
        let role_ok: i64 = conn.query_row("SELECT COUNT(*) FROM roles WHERE id = ?1", [role_id], |r| r.get(0))?;
        if role_ok == 0 {
            return Err(CmdError::new("VALIDATION", "Role not found."));
        }
        if let Some(id) = util::opt_id(payload.get("id").unwrap_or(&Value::Null)) {
            let dup: i64 = conn.query_row("SELECT COUNT(*) FROM users WHERE LOWER(username) = LOWER(?1) AND id != ?2", params![username, id], |r| r.get(0))?;
            if dup > 0 {
                return Err(CmdError::new("DUPLICATE", "Username already exists."));
            }
            let active = if payload.get("active").and_then(serde_json::Value::as_bool).unwrap_or(true) { 1 } else { 0 };
            conn.execute("UPDATE users SET full_name = ?1, username = ?2, role_id = ?3, active = ?4, updated_at = ?5 WHERE id = ?6",
                params![full_name, username, role_id, active, util::now_local(), id])?;
            if let Some(pw) = payload.get("password").and_then(serde_json::Value::as_str) {
                if !pw.is_empty() {
                    if pw.len() < 8 {
                        return Err(CmdError::new("VALIDATION", "Password must be at least 8 characters."));
                    }
                    conn.execute("UPDATE users SET password_hash = ?1 WHERE id = ?2", params![crate::auth::hash_password(pw)?, id])?;
                }
            }
            drop(conn);
            state.audit("user.updated", "user", Some(id), &format!("User {username} updated"), None, Some(json!({"roleId": role_id}).to_string()));
            return Ok(json!({ "id": id }));
        }
        let dup: i64 = conn.query_row("SELECT COUNT(*) FROM users WHERE LOWER(username) = LOWER(?1)", [&username], |r| r.get(0))?;
        if dup > 0 {
            return Err(CmdError::new("DUPLICATE", "Username already exists."));
        }
        let pw = payload.get("password").and_then(serde_json::Value::as_str).unwrap_or("");
        if pw.len() < 8 {
            return Err(CmdError::new("VALIDATION", "Password must be at least 8 characters."));
        }
        conn.execute("INSERT INTO users (full_name, username, password_hash, role_id, active, created_at, updated_at) VALUES (?1, ?2, ?3, ?4, 1, ?5, ?5)",
            params![full_name, username, crate::auth::hash_password(pw)?, role_id, util::now_local()])?;
        let id = conn.last_insert_rowid();
        drop(conn);
        state.audit("user.created", "user", Some(id), &format!("User {username} created"), None, Some(json!({"roleId": role_id}).to_string()));
        Ok(json!({ "id": id }))
    })()
    .map_err(err)
}

#[tauri::command]
pub fn users_delete(state: State<'_, AppState>, payload: Value) -> Result<Value, String> {
    (|| -> CmdResult<Value> {
        state.gate("users_delete")?;
        state.need("users.manage")?;
        let id = util::req_int(payload.get("id").unwrap_or(&Value::Null), "id", 1, i64::MAX)?;
        if let Some(me) = state.optional_session() {
            if me.id == id {
                return Err(CmdError::new("VALIDATION", "You cannot delete your own account."));
            }
        }
        let conn = state.conn.lock().unwrap();
        let target = util::query_one(&conn, "SELECT u.*, r.name AS role_name FROM users u JOIN roles r ON r.id = u.role_id WHERE u.id = ?1", &[&id])?
            .ok_or_else(|| CmdError::new("NOT_FOUND", "User not found."))?;
        if target["role_name"].as_str().unwrap_or("") == "Owner" {
            let owners: i64 = conn.query_row("SELECT COUNT(*) FROM users u JOIN roles r ON r.id = u.role_id WHERE r.name = 'Owner' AND u.active = 1", (), |r| r.get(0)).unwrap_or(0);
            if owners <= 1 {
                return Err(CmdError::new("VALIDATION", "Cannot delete the last active Owner account."));
            }
        }
        conn.execute("DELETE FROM users WHERE id = ?1", [id])?;
        drop(conn);
        state.audit("user.deleted", "user", Some(id), &format!("User {} deleted", target["username"].as_str().unwrap_or("")), Some(target.to_string()), None);
        Ok(json!({ "id": id }))
    })()
    .map_err(err)
}

// ------------------------------------------------------------ roles
#[tauri::command]
pub fn roles_list(state: State<'_, AppState>) -> Result<Value, String> {
    (|| -> CmdResult<Value> {
        state.gate("roles_list")?;
        state.need("roles.manage")?;
        let conn = state.conn.lock().unwrap();
        let roles = util::query_all(&conn, "SELECT r.*, (SELECT COUNT(*) FROM users u WHERE u.role_id = r.id) AS user_count FROM roles r ORDER BY r.name", params!())?;
        let grants = util::query_all(&conn, "SELECT role_id, permission_code FROM role_permissions", params!())?;
        let mut by_role: std::collections::HashMap<i64, Vec<String>> = std::collections::HashMap::new();
        for g in &grants {
            by_role.entry(g["role_id"].as_i64().unwrap_or(0)).or_default().push(g["permission_code"].as_str().unwrap_or("").to_string());
        }
        let perms = util::query_all(&conn, "SELECT * FROM permissions ORDER BY module, name", params!())?;
        let out: Vec<Value> = roles.into_iter().map(|mut r| {
            let rid = r["id"].as_i64().unwrap_or(0);
            r["permissions"] = if r["name"].as_str().unwrap_or("") == "Owner" {
                json!(["*"])
            } else {
                json!(by_role.get(&rid).cloned().unwrap_or_default())
            };
            r
        }).collect();
        Ok(json!({ "roles": out, "permissions": perms }))
    })()
    .map_err(err)
}

#[tauri::command]
pub fn roles_save(state: State<'_, AppState>, payload: Value) -> Result<Value, String> {
    (|| -> CmdResult<Value> {
        state.gate("roles_save")?;
        state.need("roles.manage")?;
        let name = util::req_text(payload.get("name").unwrap_or(&Value::Null), "Role name", 64)?;
        let perms: Vec<String> = payload.get("permissions").and_then(serde_json::Value::as_array).map(|a| a.iter().filter_map(|p| p.as_str().map(ToString::to_string)).collect()).unwrap_or_default();
        let conn = state.conn.lock().unwrap();
        let desc = util::opt_text(payload.get("description").unwrap_or(&Value::Null), 300);
        if let Some(id) = util::opt_id(payload.get("id").unwrap_or(&Value::Null)) {
            let before = util::query_one(&conn, "SELECT * FROM roles WHERE id = ?1", &[&id])?
                .ok_or_else(|| CmdError::new("NOT_FOUND", "Role not found."))?;
            if before["system_role"].as_i64().unwrap_or(0) != 0 && name != before["name"].as_str().unwrap_or("") {
                return Err(CmdError::new("VALIDATION", "System role names cannot be changed."));
            }
            conn.execute("UPDATE roles SET name = ?1, description = ?2, updated_at = ?3 WHERE id = ?4", params![name, desc, util::now_local(), id])?;
            conn.execute("DELETE FROM role_permissions WHERE role_id = ?1", [id])?;
            for p in &perms {
                if p == "*" {
                    continue;
                }
                conn.execute("INSERT OR IGNORE INTO role_permissions (role_id, permission_code) VALUES (?1, ?2)", params![id, p])?;
            }
            drop(conn);
            state.audit("role.updated", "role", Some(id), &format!("Role {name} updated"),
                Some(json!({"permissions": "…"}).to_string()), Some(json!({"permissions": perms}).to_string()));
            return Ok(json!({ "id": id }));
        }
        let dup: i64 = conn.query_row("SELECT COUNT(*) FROM roles WHERE LOWER(name) = LOWER(?1)", [&name], |r| r.get(0))?;
        if dup > 0 {
            return Err(CmdError::new("DUPLICATE", "Role name already exists."));
        }
        conn.execute("INSERT INTO roles (name, description, system_role, created_at, updated_at) VALUES (?1, ?2, 0, ?3, ?3)", params![name, desc, util::now_local()])?;
        let id = conn.last_insert_rowid();
        for p in &perms {
            if p == "*" {
                continue;
            }
            conn.execute("INSERT OR IGNORE INTO role_permissions (role_id, permission_code) VALUES (?1, ?2)", params![id, p])?;
        }
        drop(conn);
        state.audit("role.created", "role", Some(id), &format!("Role {name} created"), None, Some(json!({"permissions": perms}).to_string()));
        Ok(json!({ "id": id }))
    })()
    .map_err(err)
}

#[tauri::command]
pub fn roles_delete(state: State<'_, AppState>, payload: Value) -> Result<Value, String> {
    (|| -> CmdResult<Value> {
        state.gate("roles_delete")?;
        state.need("roles.manage")?;
        let id = util::req_int(payload.get("id").unwrap_or(&Value::Null), "id", 1, i64::MAX)?;
        let conn = state.conn.lock().unwrap();
        let r = util::query_one(&conn, "SELECT * FROM roles WHERE id = ?1", &[&id])?
            .ok_or_else(|| CmdError::new("NOT_FOUND", "Role not found."))?;
        if r["system_role"].as_i64().unwrap_or(0) != 0 {
            return Err(CmdError::new("VALIDATION", "System roles cannot be deleted."));
        }
        let users: i64 = conn.query_row("SELECT COUNT(*) FROM users WHERE role_id = ?1", [id], |r| r.get(0)).unwrap_or(0);
        if users > 0 {
            return Err(CmdError::new("HAS_USERS", format!("Role is assigned to {users} user(s). Reassign them first.")));
        }
        conn.execute("DELETE FROM roles WHERE id = ?1", [id])?;
        drop(conn);
        state.audit("role.deleted", "role", Some(id), &format!("Role {} deleted", r["name"].as_str().unwrap_or("")), Some(r.to_string()), None);
        Ok(json!({ "id": id }))
    })()
    .map_err(err)
}

// ------------------------------------------------------------ clinic/dentists
#[tauri::command]
pub fn clinic_get(state: State<'_, AppState>) -> Result<Value, String> {
    (|| -> CmdResult<Value> {
        state.gate("clinic_get")?;
        let conn = state.conn.lock().unwrap();
        util::query_one(&conn, "SELECT * FROM clinic WHERE id = 1", params!())
            .and_then(|r| r.ok_or_else(|| CmdError::new("NOT_FOUND", "Clinic not found.")))
    })()
    .map_err(err)
}

#[tauri::command]
pub fn clinic_update(state: State<'_, AppState>, payload: Value) -> Result<Value, String> {
    (|| -> CmdResult<Value> {
        state.gate("clinic_update")?;
        state.need("settings.manage")?;
        let name = util::req_text(payload.get("name").unwrap_or(&json!("Dental Care")), "Clinic name", 200)?;
        let conn = state.conn.lock().unwrap();
        let g = |k: &str, m: usize| util::opt_text(payload.get(k).unwrap_or(&Value::Null), m);
        let logo_path: Option<String> = if payload.get("logoPath").is_some() {
            payload.get("logoPath").and_then(serde_json::Value::as_str).filter(|s| !s.is_empty()).map(ToString::to_string)
        } else {
            conn.query_row("SELECT logo_path FROM clinic WHERE id = 1", (), |r| r.get(0)).ok()
        };
        conn.execute("UPDATE clinic SET name = ?1, address = ?2, phone = ?3, email = ?4, website = ?5, opening_hours = ?6, closing_hours = ?7, weekly_off = ?8, message = ?9, footer_text = ?10, logo_path = ?11, updated_at = ?12 WHERE id = 1",
            params![name, g("address", 500), g("phone", 120), g("email", 120), g("website", 120), g("openingHours", 60), g("closingHours", 60),
                g("weeklyOff", 120), g("message", 1000), g("footerText", 1000), logo_path, util::now_local()])?;
        drop(conn);
        state.audit("clinic.updated", "clinic", Some(1), "Clinic information updated", None, None);
        Ok(json!({ "ok": true }))
    })()
    .map_err(err)
}

#[tauri::command]
pub fn dentists_list(state: State<'_, AppState>) -> Result<Value, String> {
    (|| -> CmdResult<Value> {
        state.gate("dentists_list")?;
        let conn = state.conn.lock().unwrap();
        let rows = util::query_all(&conn, "SELECT * FROM dentists ORDER BY sort_order, name", params!())?;
        let mut out = Vec::new();
        for mut d in rows {
            let did = d["id"].as_i64().unwrap_or(0);
            let des: Vec<String> = util::query_all(&conn, "SELECT designation FROM dentist_designations WHERE dentist_id = ?1 ORDER BY sort_order", &[&did])?
                .iter().filter_map(|x| x["designation"].as_str().map(ToString::to_string)).collect();
            d["designations"] = json!(des);
            out.push(d);
        }
        Ok(json!(out))
    })()
    .map_err(err)
}

#[tauri::command]
pub fn dentists_save(state: State<'_, AppState>, payload: Value) -> Result<Value, String> {
    (|| -> CmdResult<Value> {
        state.gate("dentists_save")?;
        state.need("settings.manage")?;
        let name = util::req_text(payload.get("name").unwrap_or(&Value::Null), "Dentist name", 160)?;
        let designations: Vec<String> = payload.get("designations").and_then(serde_json::Value::as_array)
            .map(|a| a.iter().filter_map(serde_json::Value::as_str).map(|s| s.trim().to_string()).filter(|s| !s.is_empty()).take(10).collect())
            .unwrap_or_default();
        let conn = state.conn.lock().unwrap();
        let g = |k: &str, m: usize| util::opt_text(payload.get(k).unwrap_or(&Value::Null), m);
        let active = if payload.get("active").and_then(serde_json::Value::as_bool).unwrap_or(true) { 1 } else { 0 };
        if let Some(id) = util::opt_id(payload.get("id").unwrap_or(&Value::Null)) {
            conn.execute("UPDATE dentists SET name = ?1, phone = ?2, email = ?3, registration_no = ?4, active = ?5, updated_at = ?6 WHERE id = ?7",
                params![name, g("phone", 64), g("email", 120), g("registrationNo", 120), active, util::now_local(), id])?;
            conn.execute("DELETE FROM dentist_designations WHERE dentist_id = ?1", [id])?;
            for (i, d) in designations.iter().enumerate() {
                conn.execute("INSERT INTO dentist_designations (dentist_id, designation, sort_order) VALUES (?1, ?2, ?3)", params![id, d.chars().take(200).collect::<String>(), i as i64])?;
            }
            drop(conn);
            state.audit("dentist.updated", "dentist", Some(id), &format!("Dentist {name} updated"), None, Some(payload.to_string()));
            return Ok(json!({ "id": id }));
        }
        let sort: i64 = conn.query_row("SELECT COUNT(*) FROM dentists", (), |r| r.get(0)).unwrap_or(0);
        conn.execute("INSERT INTO dentists (name, phone, email, registration_no, active, sort_order, created_at, updated_at) VALUES (?1, ?2, ?3, ?4, 1, ?5, ?6, ?6)",
            params![name, g("phone", 64), g("email", 120), g("registrationNo", 120), sort, util::now_local()])?;
        let id = conn.last_insert_rowid();
        for (i, d) in designations.iter().enumerate() {
            conn.execute("INSERT INTO dentist_designations (dentist_id, designation, sort_order) VALUES (?1, ?2, ?3)", params![id, d.chars().take(200).collect::<String>(), i as i64])?;
        }
        drop(conn);
        state.audit("dentist.created", "dentist", Some(id), &format!("Dentist {name} created"), None, Some(payload.to_string()));
        Ok(json!({ "id": id }))
    })()
    .map_err(err)
}

#[tauri::command]
pub fn dentists_delete(state: State<'_, AppState>, payload: Value) -> Result<Value, String> {
    (|| -> CmdResult<Value> {
        state.gate("dentists_delete")?;
        state.need("settings.manage")?;
        let id = util::req_int(payload.get("id").unwrap_or(&Value::Null), "id", 1, i64::MAX)?;
        let conn = state.conn.lock().unwrap();
        let refs: i64 = conn.query_row("SELECT COUNT(*) FROM appointments WHERE dentist_id = ?1", [id], |r| r.get(0)).unwrap_or(0)
            + conn.query_row("SELECT COUNT(*) FROM visits WHERE dentist_id = ?1", [id], |r| r.get(0)).unwrap_or(0);
        if refs > 0 {
            conn.execute("UPDATE dentists SET active = 0 WHERE id = ?1", [id])?;
            drop(conn);
            state.audit("dentist.deactivated", "dentist", Some(id), &format!("Dentist #{id} deactivated ({refs} linked records preserved)"), None, None);
            return Ok(json!({ "id": id, "deactivated": true }));
        }
        conn.execute("DELETE FROM dentists WHERE id = ?1", [id])?;
        drop(conn);
        state.audit("dentist.deleted", "dentist", Some(id), &format!("Dentist #{id} deleted"), None, None);
        Ok(json!({ "id": id }))
    })()
    .map_err(err)
}

// ------------------------------------------------------------ printers
#[tauri::command]
pub fn printer_profiles_list(state: State<'_, AppState>) -> Result<Value, String> {
    (|| -> CmdResult<Value> {
        state.gate("printer_profiles_list")?;
        let conn = state.conn.lock().unwrap();
        util::query_all(&conn, "SELECT * FROM printer_profiles ORDER BY document_type, name", params!()).map(|v| json!(v))
    })()
    .map_err(err)
}

#[tauri::command]
pub fn printer_profiles_save(state: State<'_, AppState>, payload: Value) -> Result<Value, String> {
    (|| -> CmdResult<Value> {
        state.gate("printer_profiles_save")?;
        state.need("printers.manage")?;
        let name = util::req_text(payload.get("name").unwrap_or(&Value::Null), "Profile name", 120)?;
        let doc_type = { let d = util::opt_text(payload.get("documentType").unwrap_or(&Value::Null), 32); if d.is_empty() { "prescription".to_string() } else { d } };
        let conn = state.conn.lock().unwrap();
        if payload.get("isDefault").and_then(serde_json::Value::as_bool).unwrap_or(false) {
            conn.execute("UPDATE printer_profiles SET is_default = 0 WHERE document_type = ?1", [&doc_type])?;
        }
        let paper = { let p = util::opt_text(payload.get("paperSize").unwrap_or(&Value::Null), 24); if p.is_empty() { "A4".to_string() } else { p } };
        let margins = { let m = util::opt_text(payload.get("marginsMm").unwrap_or(&Value::Null), 48); if m.is_empty() { "12,12,14,12".to_string() } else { m } };
        let orient = { let o = util::opt_text(payload.get("orientation").unwrap_or(&Value::Null), 16); if o.is_empty() { "portrait".to_string() } else { o } };
        let header = { let h = util::opt_text(payload.get("headerMode").unwrap_or(&Value::Null), 24); if h.is_empty() { "full".to_string() } else { h } };
        let footer = { let f = util::opt_text(payload.get("footerMode").unwrap_or(&Value::Null), 24); if f.is_empty() { "full".to_string() } else { f } };
        let copies = util::req_int(payload.get("copies").unwrap_or(&json!(1)), "copies", 1, 10)?;
        let scale = payload.get("fontScale").and_then(serde_json::Value::as_f64).unwrap_or(1.0);
        let is_default = if payload.get("isDefault").and_then(serde_json::Value::as_bool).unwrap_or(false) { 1 } else { 0 };
        let printer_name = util::opt_text(payload.get("printerName").unwrap_or(&Value::Null), 160);
        if let Some(id) = util::opt_id(payload.get("id").unwrap_or(&Value::Null)) {
            conn.execute("UPDATE printer_profiles SET name = ?1, document_type = ?2, printer_name = ?3, paper_size = ?4, margins_mm = ?5, orientation = ?6, font_scale = ?7, header_mode = ?8, footer_mode = ?9, copies = ?10, is_default = ?11, updated_at = ?12 WHERE id = ?13",
                params![name, doc_type, printer_name, paper, margins, orient, scale, header, footer, copies, is_default, util::now_local(), id])?;
            return Ok(json!({ "id": id }));
        }
        conn.execute("INSERT INTO printer_profiles (name, document_type, printer_name, paper_size, margins_mm, orientation, font_scale, header_mode, footer_mode, copies, is_default, created_at, updated_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?12)",
            params![name, doc_type, printer_name, paper, margins, orient, scale, header, footer, copies, is_default, util::now_local()])?;
        let id = conn.last_insert_rowid();
        Ok(json!({ "id": id }))
    })()
    .map_err(err)
}
