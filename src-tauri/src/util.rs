// Dentiva Pro — shared native helpers: time, validation, row mapping.

use chrono::Local;
use rusqlite::{Connection, Row};
use serde_json::{Map, Value};

use crate::error::{CmdError, CmdResult};

pub fn now_local() -> String {
    Local::now().format("%Y-%m-%dT%H:%M:%S").to_string()
}

pub fn today() -> String {
    Local::now().format("%Y-%m-%d").to_string()
}

pub fn row_to_json(row: &Row) -> rusqlite::Result<Value> {
    let mut map = Map::new();
    for (i, col) in row.as_ref().column_names().iter().enumerate() {
        let v: rusqlite::types::Value = row.get(i)?;
        let j = match v {
            rusqlite::types::Value::Null => Value::Null,
            rusqlite::types::Value::Integer(n) => Value::from(n),
            rusqlite::types::Value::Real(f) => serde_json::Number::from_f64(f).map(Value::Number).unwrap_or(Value::Null),
            rusqlite::types::Value::Text(s) => Value::from(s),
            rusqlite::types::Value::Blob(b) => Value::from(base64::Engine::encode(
                &base64::engine::general_purpose::STANDARD,
                b,
            )),
        };
        map.insert(col.to_string(), j);
    }
    Ok(Value::Object(map))
}

pub fn query_all(conn: &Connection, sql: &str, params: &[&dyn rusqlite::ToSql]) -> CmdResult<Vec<Value>> {
    let mut stmt = conn.prepare(sql)?;
    let rows = stmt.query_map(params, row_to_json)?;
    let mut out = Vec::new();
    for r in rows {
        out.push(r?);
    }
    Ok(out)
}

pub fn query_one(conn: &Connection, sql: &str, params: &[&dyn rusqlite::ToSql]) -> CmdResult<Option<Value>> {
    let mut stmt = conn.prepare(sql)?;
    let mut rows = stmt.query_map(params, row_to_json)?;
    Ok(rows.next().transpose()?)
}

pub fn setting(conn: &Connection, key: &str, fallback: &str) -> String {
    conn.query_row("SELECT value FROM app_settings WHERE key = ?1", [key], |r| r.get::<_, String>(0))
        .unwrap_or_else(|_| fallback.to_string())
}

pub fn meta_get(conn: &Connection, key: &str) -> String {
    conn.query_row("SELECT value FROM meta WHERE key = ?1", [key], |r| r.get::<_, String>(0))
        .unwrap_or_default()
}

pub fn meta_set(conn: &Connection, key: &str, value: &str) -> CmdResult<()> {
    conn.execute(
        "INSERT INTO meta (key, value) VALUES (?1, ?2) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
        [key, value],
    )?;
    Ok(())
}

// ------------------------------------------------------------ validation
pub fn req_text(v: &Value, field: &str, max: usize) -> CmdResult<String> {
    let s = v.as_str().unwrap_or("").trim().to_string();
    if s.is_empty() {
        return Err(CmdError::new("VALIDATION", format!("{field} is required.")));
    }
    if s.len() > max {
        return Err(CmdError::new("VALIDATION", format!("{field} is too long (max {max} characters).")));
    }
    Ok(s)
}

pub fn opt_text(v: &Value, max: usize) -> String {
    v.as_str().unwrap_or("").trim().chars().take(max).collect()
}

pub fn req_int(v: &Value, field: &str, min: i64, max: i64) -> CmdResult<i64> {
    let n = v.as_i64().ok_or_else(|| CmdError::new("VALIDATION", format!("{field} must be a whole number.")))?;
    if n < min || n > max {
        return Err(CmdError::new("VALIDATION", format!("{field} is out of range.")));
    }
    Ok(n)
}

pub fn req_money(v: &Value, field: &str) -> CmdResult<i64> {
    req_int(v, field, 0, i64::MAX / 2)
}

pub fn req_date(v: &Value, field: &str) -> CmdResult<String> {
    let s = req_text(v, field, 10)?;
    if s.len() != 10 || s.as_bytes()[4] != b'-' || s.as_bytes()[7] != b'-' {
        return Err(CmdError::new("VALIDATION", format!("{field} must be a valid date.")));
    }
    Ok(s)
}

pub fn opt_id(v: &Value) -> Option<i64> {
    v.as_i64().filter(|n| *n > 0)
}

pub fn safe_filename(name: &str) -> String {
    let base = name.rsplit(['/', '\\']).next().unwrap_or("file");
    let clean: String = base
        .chars()
        .map(|c| {
            if c.is_ascii_alphanumeric() || "._+-() ".contains(c) || ('\u{0980}'..='\u{09FF}').contains(&c) {
                c
            } else {
                '_'
            }
        })
        .collect();
    let trimmed: String = clean.chars().take(120).collect();
    if trimmed.trim().is_empty() {
        "file".to_string()
    } else {
        trimmed
    }
}
