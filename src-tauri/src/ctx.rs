// Dentiva Pro — command context: app state, session, RBAC, audit, notify.

use rusqlite::Connection;
use serde::{Deserialize, Serialize};
use std::sync::Mutex;

use crate::db::Paths;
use crate::error::{CmdError, CmdResult};
use crate::util;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SessionUser {
    pub id: i64,
    #[serde(rename = "fullName")]
    pub full_name: String,
    pub username: String,
    #[serde(rename = "roleId")]
    pub role_id: i64,
    #[serde(rename = "roleName")]
    pub role_name: String,
    pub permissions: Vec<String>,
}

pub struct AppState {
    pub conn: Mutex<Connection>,
    pub paths: Paths,
    pub install_id: String,
    pub session: Mutex<Option<SessionUser>>,
    pub locked: Mutex<bool>,
}

impl AppState {
    pub fn need(&self, code: &str) -> CmdResult<SessionUser> {
        if *self.locked.lock().unwrap() {
            return Err(CmdError::new("LOCKED", "Application is locked. Please unlock to continue."));
        }
        let guard = self.session.lock().unwrap();
        let s = guard.clone().ok_or_else(|| CmdError::new("UNAUTHENTICATED", "Please log in to continue."))?;
        if !s.permissions.iter().any(|p| p == "*" || p == code) {
            return Err(CmdError::new("PERMISSION_DENIED", "You do not have permission to perform this action."));
        }
        Ok(s)
    }

    pub fn optional_session(&self) -> Option<SessionUser> {
        if *self.locked.lock().unwrap() {
            return None;
        }
        self.session.lock().unwrap().clone()
    }

    /// Activation/setup gate, mirroring the fallback backend router: everything
    /// except status/activation/setup requires activation; everything except
    /// those plus login requires completed setup.
    pub fn gate(&self, cmd: &str) -> CmdResult<()> {
        let conn = self.conn.lock().unwrap();
        if !["app_status", "activate", "setup_init"].contains(&cmd)
            && crate::util::meta_get(&conn, "activated") != "1"
        {
            return Err(CmdError::new("NOT_ACTIVATED", "Application is not activated."));
        }
        if !["app_status", "activate", "setup_init", "login"].contains(&cmd)
            && crate::util::meta_get(&conn, "setup_complete") != "1"
        {
            return Err(CmdError::new("NOT_SETUP", "Initial setup is not complete."));
        }
        Ok(())
    }

    pub fn audit(&self, action: &str, entity_type: &str, entity_id: Option<i64>, summary: &str, before: Option<String>, after: Option<String>) {
        let s = self.session.lock().unwrap().clone();
        let (uid, uname) = s.map(|u| (Some(u.id), u.username)).unwrap_or((None, String::new()));
        if let Ok(conn) = self.conn.lock() {
            let _ = conn.execute(
                "INSERT INTO audit_logs (timestamp, user_id, username, action, entity_type, entity_id, summary, before_json, after_json, app_context) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, 'tauri-native')",
                rusqlite::params![util::now_local(), uid, uname, action, entity_type, entity_id,
                    summary.chars().take(2000).collect::<String>(), before, after],
            );
        }
    }

    #[allow(clippy::too_many_arguments)]
    pub fn notify(&self, severity: &str, category: &str, title: &str, message: &str, entity_type: Option<&str>, entity_id: Option<i64>, route: Option<&str>) {
        if let Ok(conn) = self.conn.lock() {
            let _ = conn.execute(
                "INSERT INTO notifications (severity, category, title, message, entity_type, entity_id, action_route, is_read, created_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, 0, ?8)",
                rusqlite::params![severity, category, title.chars().take(200).collect::<String>(), message.chars().take(2000).collect::<String>(), entity_type, entity_id, route, util::now_local()],
            );
        }
    }
}

pub fn permission_set(conn: &Connection, user_id: i64) -> Vec<String> {
    let role_id: i64 = conn.query_row("SELECT role_id FROM users WHERE id = ?1", [user_id], |r| r.get(0)).unwrap_or(0);
    let role_name: String = conn.query_row("SELECT name FROM roles WHERE id = ?1", [role_id], |r| r.get(0)).unwrap_or_default();
    if role_name == "Owner" {
        return crate::db::permission_catalog().into_iter().map(|(c, _, _)| c.to_string()).collect();
    }
    conn.prepare("SELECT permission_code FROM role_permissions WHERE role_id = ?1")
        .and_then(|mut s| s.query_map([role_id], |r| r.get::<_, String>(0))?.collect::<Result<Vec<_>, _>>())
        .unwrap_or_default()
}
