// Dentiva Pro — billing/inventory/accounting commands (native backend).

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

fn next_seq(conn: &rusqlite::Connection, prefix_key: &str, next_key: &str) -> String {
    let prefix = util::setting(conn, prefix_key, "");
    let next: i64 = util::setting(conn, next_key, "1")
        .parse()
        .unwrap_or(1)
        .max(1);
    let _ = conn.execute(
        "UPDATE app_settings SET value = ?1 WHERE key = ?2",
        params![(next + 1).to_string(), next_key],
    );
    let ymd = chrono::Utc::now().format("%Y%m%d").to_string();
    format!("{prefix}{ymd}-{next:04}")
}

fn invoice_status(total: i64, paid: i64, prev: &str) -> String {
    if prev == "Cancelled" {
        return "Cancelled".to_string();
    }
    if paid <= 0 {
        return "Due".to_string();
    }
    if paid >= total {
        return "Paid".to_string();
    }
    "Partially Paid".to_string()
}

fn stock_balance(conn: &rusqlite::Connection, item_id: i64) -> i64 {
    conn.query_row(
        "SELECT COALESCE(SUM(qty_remaining), 0) FROM inventory_batches WHERE item_id = ?1",
        [item_id],
        |r| r.get(0),
    )
    .unwrap_or(0)
}

// ------------------------------------------------------------ invoices
#[tauri::command]
pub fn invoices_list(state: State<'_, AppState>, payload: Value) -> Result<Value, String> {
    (|| -> CmdResult<Value> {
        state.gate("invoices_list")?;
        state.need("invoices.view")?;
        let conn = state.conn.lock().unwrap();
        let mut conds: Vec<String> = Vec::new();
        let mut args: Vec<String> = Vec::new();
        if let Some(p) = payload.get("patientId").and_then(serde_json::Value::as_i64) {
            if p > 0 { conds.push(format!("i.patient_id = {p}")); }
        }
        if let Some(f) = payload.get("from").and_then(serde_json::Value::as_str) {
            if !f.is_empty() { conds.push(format!("i.invoice_date >= ?{}", args.len() + 1)); args.push(f.to_string()); }
        }
        if let Some(t) = payload.get("to").and_then(serde_json::Value::as_str) {
            if !t.is_empty() { conds.push(format!("i.invoice_date <= ?{}", args.len() + 1)); args.push(t.to_string()); }
        }
        if let Some(s) = payload.get("status").and_then(serde_json::Value::as_str) {
            if !s.is_empty() { conds.push(format!("i.status = ?{}", args.len() + 1)); args.push(s.to_string()); }
        }
        if let Some(q) = payload.get("search").and_then(serde_json::Value::as_str) {
            if !q.is_empty() {
                conds.push(format!("(i.invoice_no LIKE ?{} OR pt.name LIKE ?{} OR pt.code LIKE ?{})", args.len() + 1, args.len() + 1, args.len() + 1));
                args.push(format!("%{q}%"));
            }
        }
        let w = if conds.is_empty() { String::new() } else { format!("WHERE {}", conds.join(" AND ")) };
        let page = payload.get("page").and_then(serde_json::Value::as_i64).unwrap_or(1).max(1);
        let page_size = payload.get("pageSize").and_then(serde_json::Value::as_i64).unwrap_or(25).clamp(5, 200);
        let refs: Vec<&dyn rusqlite::ToSql> = args.iter().map(|v| v as &dyn rusqlite::ToSql).collect();
        let total: i64 = conn.query_row(&format!("SELECT COUNT(*) FROM invoices i JOIN patients pt ON pt.id = i.patient_id {w}"), &refs[..], |r| r.get(0)).unwrap_or(0);
        let rows = util::query_all(&conn, &format!("SELECT i.*, pt.name AS patient_name, pt.code AS patient_code, d.name AS dentist_name
            FROM invoices i JOIN patients pt ON pt.id = i.patient_id LEFT JOIN dentists d ON d.id = i.dentist_id
            {w} ORDER BY i.invoice_date DESC, i.id DESC LIMIT {page_size} OFFSET {}", (page - 1) * page_size), &refs)?;
        Ok(json!({ "rows": rows, "total": total, "page": page, "pageSize": page_size }))
    })()
    .map_err(err)
}

#[tauri::command]
pub fn invoices_get(state: State<'_, AppState>, payload: Value) -> Result<Value, String> {
    (|| -> CmdResult<Value> {
        state.gate("invoices_get")?;
        state.need("invoices.view")?;
        let id = util::req_int(payload.get("id").unwrap_or(&Value::Null), "id", 1, i64::MAX)?;
        let conn = state.conn.lock().unwrap();
        let inv = util::query_one(&conn, "SELECT i.*, pt.name AS patient_name, pt.code AS patient_code, pt.phone AS patient_phone, pt.address AS patient_address, d.name AS dentist_name FROM invoices i JOIN patients pt ON pt.id = i.patient_id LEFT JOIN dentists d ON d.id = i.dentist_id WHERE i.id = ?1", &[&id])?
            .ok_or_else(|| CmdError::new("NOT_FOUND", "Invoice not found."))?;
        let items = util::query_all(&conn, "SELECT * FROM invoice_items WHERE invoice_id = ?1 ORDER BY sort_order, id", &[&id])?;
        let payments = util::query_all(&conn, "SELECT * FROM payments WHERE invoice_id = ?1 ORDER BY payment_date DESC", &[&id])?;
        let allocs = util::query_all(&conn, "SELECT pa.*, p.receipt_no FROM payment_allocations pa JOIN payments p ON p.id = pa.payment_id WHERE pa.invoice_id = ?1", &[&id])?;
        let mut out = inv.clone();
        out["items"] = json!(items);
        out["payments"] = json!(payments);
        out["allocations"] = json!(allocs);
        Ok(out)
    })()
    .map_err(err)
}

#[tauri::command]
pub fn invoices_save(state: State<'_, AppState>, payload: Value) -> Result<Value, String> {
    (|| -> CmdResult<Value> {
        state.gate("invoices_save")?;
        let is_update = payload.get("id").and_then(serde_json::Value::as_i64).unwrap_or(0) > 0;
        let me = state.need(if is_update { "invoices.edit" } else { "invoices.create" })?;
        let patient_id = util::req_int(payload.get("patientId").unwrap_or(&Value::Null), "patientId", 1, i64::MAX)?;
        let items = payload.get("items").and_then(serde_json::Value::as_array).cloned().unwrap_or_default();
        if items.is_empty() {
            return Err(CmdError::new("VALIDATION", "At least one invoice item is required."));
        }
        let date = util::req_date(payload.get("invoiceDate").unwrap_or(&json!(util::today())), "invoiceDate")?;
        let discount = util::req_money(payload.get("discountPaisa").unwrap_or(&Value::Null), "discount")?;
        let tax = util::req_money(payload.get("taxPaisa").unwrap_or(&Value::Null), "tax")?;
        let mut subtotal: i64 = 0;
        let mut lines: Vec<(Option<i64>, String, String, i64, i64, i64)> = Vec::new();
        for (idx, it) in items.iter().enumerate() {
            let desc = util::req_text(it.get("description").unwrap_or(&Value::Null), &format!("Item #{} description", idx + 1), 300)?;
            let qty = util::req_int(it.get("qty").unwrap_or(&json!(1)), "qty", 1, 1000)?;
            let unit = util::req_money(it.get("unitPricePaisa").unwrap_or(&Value::Null), "unit price")?;
            let line = qty.saturating_mul(unit);
            subtotal = subtotal.saturating_add(line);
            lines.push((util::opt_id(it.get("treatmentId").unwrap_or(&Value::Null)), desc, util::opt_text(it.get("toothCodes").unwrap_or(&Value::Null), 120), qty, unit, line));
        }
        if discount > subtotal + tax {
            return Err(CmdError::new("VALIDATION", "Discount cannot exceed the invoice total."));
        }
        let total = subtotal - discount + tax;
        let conn = state.conn.lock().unwrap();
        let mut rid = 0i64;
        let mut invoice_no = String::new();
        let notes = util::opt_text(payload.get("notes").unwrap_or(&Value::Null), 2000);
        let visit_id = payload.get("visitId").and_then(serde_json::Value::as_i64).filter(|n| *n > 0);
        let dentist_id = payload.get("dentistId").and_then(serde_json::Value::as_i64).filter(|n| *n > 0);
        txn(&conn, || {
            if is_update {
                rid = payload.get("id").and_then(serde_json::Value::as_i64).unwrap_or(0);
                let ex = util::query_one(&conn, "SELECT * FROM invoices WHERE id = ?1", &[&rid])?
                    .ok_or_else(|| CmdError::new("NOT_FOUND", "Invoice not found."))?;
                let paid = ex["paid_paisa"].as_i64().unwrap_or(0);
                if paid > 0 && !payload.get("allowEditPaid").and_then(serde_json::Value::as_bool).unwrap_or(false) {
                    return Err(CmdError::new("HAS_PAYMENTS", "This invoice has payments recorded. Editing amounts is blocked to protect history."));
                }
                if total < paid {
                    return Err(CmdError::new("VALIDATION", "New total cannot be less than the amount already paid."));
                }
                invoice_no = ex["invoice_no"].as_str().unwrap_or("").to_string();
                conn.execute("UPDATE invoices SET patient_id = ?1, visit_id = ?2, dentist_id = ?3, invoice_date = ?4, subtotal_paisa = ?5, discount_paisa = ?6, tax_paisa = ?7, total_paisa = ?8, status = ?9, notes = ?10, updated_at = ?11 WHERE id = ?12",
                    params![patient_id, visit_id, dentist_id, date, subtotal, discount, tax, total, invoice_status(total, paid, ex["status"].as_str().unwrap_or("")), notes, util::now_local(), rid])?;
                conn.execute("DELETE FROM invoice_items WHERE invoice_id = ?1", [rid])?;
            } else {
                invoice_no = next_seq(&conn, "invoice_prefix", "invoice_next");
                conn.execute("INSERT INTO invoices (invoice_no, patient_id, visit_id, dentist_id, invoice_date, subtotal_paisa, discount_paisa, tax_paisa, total_paisa, paid_paisa, status, notes, created_by, created_at, updated_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, 0, ?10, ?11, ?12, ?13, ?13)",
                    params![invoice_no, patient_id, visit_id, dentist_id, date, subtotal, discount, tax, total, if total == 0 { "Paid" } else { "Due" }, notes, me.id, util::now_local()])?;
                rid = conn.last_insert_rowid();
            }
            for (idx, l) in lines.iter().enumerate() {
                conn.execute("INSERT INTO invoice_items (invoice_id, treatment_id, description, tooth_codes, qty, unit_price_paisa, line_total_paisa, sort_order) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)",
                    params![rid, l.0, l.1, l.2, l.3, l.4, l.5, idx as i64])?;
            }
            Ok(())
        })?;
        drop(conn);
        state.audit(if is_update { "invoice.updated" } else { "invoice.created" }, "invoice", Some(rid),
            &format!("Invoice {invoice_no} {} (total {total} paisa)", if is_update { "updated" } else { "created" }), None, Some(json!({"patientId": patient_id, "total": total}).to_string()));
        Ok(json!({ "id": rid, "invoiceNo": invoice_no }))
    })()
    .map_err(err)
}

#[tauri::command]
pub fn invoices_delete(state: State<'_, AppState>, payload: Value) -> Result<Value, String> {
    (|| -> CmdResult<Value> {
        state.gate("invoices_delete")?;
        state.need("invoices.delete")?;
        let id = util::req_int(payload.get("id").unwrap_or(&Value::Null), "id", 1, i64::MAX)?;
        let conn = state.conn.lock().unwrap();
        let before = util::query_one(&conn, "SELECT * FROM invoices WHERE id = ?1", &[&id])?
            .ok_or_else(|| CmdError::new("NOT_FOUND", "Invoice not found."))?;
        if before["paid_paisa"].as_i64().unwrap_or(0) > 0 {
            return Err(CmdError::new(
                "HAS_PAYMENTS",
                "Cannot delete an invoice with recorded payments. Reverse the payments first.",
            ));
        }
        txn(&conn, || {
            conn.execute("DELETE FROM invoices WHERE id = ?1", [id])?;
            Ok(())
        })?;
        drop(conn);
        state.audit(
            "invoice.deleted",
            "invoice",
            Some(id),
            &format!(
                "Invoice {} deleted",
                before["invoice_no"].as_str().unwrap_or("")
            ),
            Some(before.to_string()),
            None,
        );
        Ok(json!({ "id": id }))
    })()
    .map_err(err)
}

// ------------------------------------------------------------ payments
const PAY_METHODS: [&str; 8] = [
    "Cash", "Bank", "Card", "bKash", "Nagad", "Rocket", "Upay", "Others",
];

#[tauri::command]
pub fn payments_list(state: State<'_, AppState>, payload: Value) -> Result<Value, String> {
    (|| -> CmdResult<Value> {
        state.gate("payments_list")?;
        state.need("payments.view")?;
        let conn = state.conn.lock().unwrap();
        let mut conds: Vec<String> = Vec::new();
        let mut args: Vec<String> = Vec::new();
        if let Some(f) = payload.get("from").and_then(serde_json::Value::as_str) {
            if !f.is_empty() { conds.push(format!("p.payment_date >= ?{}", args.len() + 1)); args.push(f.to_string()); }
        }
        if let Some(t) = payload.get("to").and_then(serde_json::Value::as_str) {
            if !t.is_empty() { conds.push(format!("p.payment_date <= ?{}", args.len() + 1)); args.push(t.to_string()); }
        }
        if let Some(m) = payload.get("method").and_then(serde_json::Value::as_str) {
            if !m.is_empty() { conds.push(format!("p.method = ?{}", args.len() + 1)); args.push(m.to_string()); }
        }
        if let Some(p) = payload.get("patientId").and_then(serde_json::Value::as_i64) {
            if p > 0 { conds.push(format!("p.patient_id = {p}")); }
        }
        if let Some(q) = payload.get("search").and_then(serde_json::Value::as_str) {
            if !q.is_empty() {
                conds.push(format!("(p.receipt_no LIKE ?{} OR pt.name LIKE ?{} OR pt.code LIKE ?{})", args.len() + 1, args.len() + 1, args.len() + 1));
                args.push(format!("%{q}%"));
            }
        }
        let w = if conds.is_empty() { String::new() } else { format!("WHERE {}", conds.join(" AND ")) };
        let page = payload.get("page").and_then(serde_json::Value::as_i64).unwrap_or(1).max(1);
        let page_size = payload.get("pageSize").and_then(serde_json::Value::as_i64).unwrap_or(25).clamp(5, 200);
        let refs: Vec<&dyn rusqlite::ToSql> = args.iter().map(|v| v as &dyn rusqlite::ToSql).collect();
        let total: i64 = conn.query_row(&format!("SELECT COUNT(*) FROM payments p JOIN patients pt ON pt.id = p.patient_id {w}"), &refs[..], |r| r.get(0)).unwrap_or(0);
        let rows = util::query_all(&conn, &format!("SELECT p.*, pt.name AS patient_name, pt.code AS patient_code, i.invoice_no, u.full_name AS created_by_name
            FROM payments p JOIN patients pt ON pt.id = p.patient_id LEFT JOIN invoices i ON i.id = p.invoice_id LEFT JOIN users u ON u.id = p.created_by
            {w} ORDER BY p.payment_date DESC, p.id DESC LIMIT {page_size} OFFSET {}", (page - 1) * page_size), &refs)?;
        let summary = util::query_all(&conn, &format!("SELECT p.method AS method, SUM(CASE WHEN p.reversed = 1 THEN 0 ELSE p.amount_paisa END) AS total FROM payments p JOIN patients pt ON pt.id = p.patient_id {w} GROUP BY p.method"), &refs)?;
        Ok(json!({ "rows": rows, "total": total, "page": page, "pageSize": page_size, "summary": summary }))
    })()
    .map_err(err)
}

#[tauri::command]
pub fn payments_create(state: State<'_, AppState>, payload: Value) -> Result<Value, String> {
    (|| -> CmdResult<Value> {
        state.gate("payments_create")?;
        let me = state.need("payments.record")?;
        let patient_id = util::req_int(payload.get("patientId").unwrap_or(&Value::Null), "patientId", 1, i64::MAX)?;
        let amount = util::req_money(payload.get("amountPaisa").unwrap_or(&Value::Null), "amount")?;
        if amount <= 0 {
            return Err(CmdError::new("VALIDATION", "Payment amount must be greater than zero."));
        }
        let method = payload.get("method").and_then(serde_json::Value::as_str).unwrap_or("Cash");
        if !PAY_METHODS.contains(&method) {
            return Err(CmdError::new("VALIDATION", "Invalid payment method."));
        }
        let date = util::req_date(payload.get("paymentDate").unwrap_or(&json!(util::today())), "paymentDate")?;
        let alloc_req = payload.get("allocations").and_then(serde_json::Value::as_array).cloned().unwrap_or_default();
        let conn = state.conn.lock().unwrap();
        let mut receipt_no = String::new();
        let mut payment_id = 0i64;
        txn(&conn, || {
            receipt_no = next_seq(&conn, "receipt_prefix", "receipt_next");
            let first_invoice: Option<i64> = if alloc_req.len() == 1 {
                alloc_req[0].get("invoiceId").and_then(serde_json::Value::as_i64).filter(|n| *n > 0)
            } else {
                payload.get("invoiceId").and_then(serde_json::Value::as_i64).filter(|n| *n > 0)
            };
            conn.execute("INSERT INTO payments (receipt_no, invoice_id, patient_id, amount_paisa, method, reference, payment_date, notes, created_by, created_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10)",
                params![receipt_no, first_invoice, patient_id, amount, method, util::opt_text(payload.get("reference").unwrap_or(&Value::Null), 120), date,
                    util::opt_text(payload.get("notes").unwrap_or(&Value::Null), 2000), me.id, util::now_local()])?;
            payment_id = conn.last_insert_rowid();
            let mut allocated = 0i64;
            if !alloc_req.is_empty() {
                for al in &alloc_req {
                    let inv_id = util::req_int(al.get("invoiceId").unwrap_or(&Value::Null), "invoiceId", 1, i64::MAX)?;
                    let amt = util::req_money(al.get("amountPaisa").unwrap_or(&Value::Null), "allocation")?;
                    let inv = util::query_one(&conn, "SELECT * FROM invoices WHERE id = ?1", &[&inv_id])?
                        .ok_or_else(|| CmdError::new("NOT_FOUND", format!("Invoice #{inv_id} not found.")))?;
                    if inv["patient_id"].as_i64().unwrap_or(0) != patient_id {
                        return Err(CmdError::new("VALIDATION", "Allocation invoice belongs to a different patient."));
                    }
                    let due = inv["total_paisa"].as_i64().unwrap_or(0) - inv["paid_paisa"].as_i64().unwrap_or(0);
                    if amt > due {
                        return Err(CmdError::new("VALIDATION", format!("Allocation of {amt} exceeds due {due} on {}.", inv["invoice_no"].as_str().unwrap_or(""))));
                    }
                    conn.execute("INSERT INTO payment_allocations (payment_id, invoice_id, amount_paisa) VALUES (?1, ?2, ?3)", params![payment_id, inv_id, amt])?;
                    let new_paid = inv["paid_paisa"].as_i64().unwrap_or(0) + amt;
                    conn.execute("UPDATE invoices SET paid_paisa = ?1, status = ?2, updated_at = ?3 WHERE id = ?4",
                        params![new_paid, invoice_status(inv["total_paisa"].as_i64().unwrap_or(0), new_paid, inv["status"].as_str().unwrap_or("")), util::now_local(), inv_id])?;
                    allocated += amt;
                }
                if allocated != amount {
                    return Err(CmdError::new("VALIDATION", "Allocation total must equal the payment amount."));
                }
            } else if let Some(fi) = first_invoice {
                let inv = util::query_one(&conn, "SELECT * FROM invoices WHERE id = ?1", &[&fi])?
                    .ok_or_else(|| CmdError::new("NOT_FOUND", "Invoice not found."))?;
                let due = inv["total_paisa"].as_i64().unwrap_or(0) - inv["paid_paisa"].as_i64().unwrap_or(0);
                if amount > due {
                    return Err(CmdError::new("VALIDATION", format!("Payment exceeds invoice due ({due} paisa).")));
                }
                conn.execute("INSERT INTO payment_allocations (payment_id, invoice_id, amount_paisa) VALUES (?1, ?2, ?3)", params![payment_id, fi, amount])?;
                let new_paid = inv["paid_paisa"].as_i64().unwrap_or(0) + amount;
                conn.execute("UPDATE invoices SET paid_paisa = ?1, status = ?2, updated_at = ?3 WHERE id = ?4",
                    params![new_paid, invoice_status(inv["total_paisa"].as_i64().unwrap_or(0), new_paid, inv["status"].as_str().unwrap_or("")), util::now_local(), fi])?;
            }
            Ok(())
        })?;
        drop(conn);
        state.audit("payment.recorded", "payment", Some(payment_id), &format!("Payment {receipt_no} recorded ({amount} paisa, {method})"), None, Some(json!({"patientId": patient_id, "amount": amount}).to_string()));
        Ok(json!({ "id": payment_id, "receiptNo": receipt_no }))
    })()
    .map_err(err)
}

#[tauri::command]
pub fn payments_reverse(state: State<'_, AppState>, payload: Value) -> Result<Value, String> {
    (|| -> CmdResult<Value> {
        state.gate("payments_reverse")?;
        state.need("payments.reverse")?;
        let id = util::req_int(payload.get("id").unwrap_or(&Value::Null), "id", 1, i64::MAX)?;
        let reason = util::req_text(payload.get("reason").unwrap_or(&Value::Null), "reason", 500)?;
        let conn = state.conn.lock().unwrap();
        let pay = util::query_one(&conn, "SELECT * FROM payments WHERE id = ?1", &[&id])?
            .ok_or_else(|| CmdError::new("NOT_FOUND", "Payment not found."))?;
        if pay["reversed"].as_i64().unwrap_or(0) != 0 {
            return Err(CmdError::new("VALIDATION", "Payment is already reversed."));
        }
        let me = state.optional_session();
        let old_notes = pay["notes"].as_str().unwrap_or("").to_string();
        txn(&conn, || {
            let allocs = util::query_all(&conn, "SELECT * FROM payment_allocations WHERE payment_id = ?1", &[&id])?;
            for al in &allocs {
                if let Some(inv) = util::query_one(&conn, "SELECT * FROM invoices WHERE id = ?1", &[&al["invoice_id"].as_i64().unwrap_or(0)])? {
                    let new_paid = (inv["paid_paisa"].as_i64().unwrap_or(0) - al["amount_paisa"].as_i64().unwrap_or(0)).max(0);
                    conn.execute("UPDATE invoices SET paid_paisa = ?1, status = ?2, updated_at = ?3 WHERE id = ?4",
                        params![new_paid, invoice_status(inv["total_paisa"].as_i64().unwrap_or(0), new_paid, inv["status"].as_str().unwrap_or("")), util::now_local(), al["invoice_id"].as_i64().unwrap_or(0)])?;
                }
            }
            conn.execute("UPDATE payments SET reversed = 1, reversed_by = ?1, reversed_at = ?2, notes = ?3 WHERE id = ?4",
                params![me.as_ref().map(|s| s.id), util::now_local(), format!("{old_notes}\n[REVERSED: {reason}]").trim().to_string(), id])?;
            Ok(())
        })?;
        drop(conn);
        state.audit("payment.reversed", "payment", Some(id), &format!("Payment {} reversed: {reason}", pay["receipt_no"].as_str().unwrap_or("")), Some(pay.to_string()), Some(json!({"reason": reason}).to_string()));
        Ok(json!({ "id": id }))
    })()
    .map_err(err)
}

// ------------------------------------------------------------ inventory
#[tauri::command]
pub fn inventory_list(state: State<'_, AppState>, payload: Value) -> Result<Value, String> {
    (|| -> CmdResult<Value> {
        state.gate("inventory_list")?;
        state.need("inventory.view")?;
        let conn = state.conn.lock().unwrap();
        let q = payload.get("search").and_then(serde_json::Value::as_str).unwrap_or("").trim().to_string();
        let mut conds: Vec<String> = Vec::new();
        let mut args: Vec<String> = Vec::new();
        if !q.is_empty() {
            conds.push(format!("(i.name LIKE ?{} OR i.sku LIKE ?{} OR i.category LIKE ?{})", args.len() + 1, args.len() + 1, args.len() + 1));
            args.push(format!("%{q}%"));
        }
        if let Some(c) = payload.get("category").and_then(serde_json::Value::as_str) {
            if !c.is_empty() { conds.push(format!("i.category = ?{}", args.len() + 1)); args.push(c.to_string()); }
        }
        let w = if conds.is_empty() { String::new() } else { format!("WHERE {}", conds.join(" AND ")) };
        let refs: Vec<&dyn rusqlite::ToSql> = args.iter().map(|v| v as &dyn rusqlite::ToSql).collect();
        let rows = util::query_all(&conn, &format!("SELECT i.*, s.name AS supplier_name,
            COALESCE((SELECT SUM(qty_remaining) FROM inventory_batches b WHERE b.item_id = i.id), 0) AS stock,
            (SELECT MIN(expiry_date) FROM inventory_batches b WHERE b.item_id = i.id AND b.qty_remaining > 0 AND b.expiry_date IS NOT NULL) AS nearest_expiry
            FROM inventory_items i LEFT JOIN suppliers s ON s.id = i.supplier_id {w} ORDER BY i.name"), &refs)?;
        let mut out = rows;
        if payload.get("lowStockOnly").and_then(serde_json::Value::as_bool).unwrap_or(false) {
            out.retain(|r| r["stock"].as_i64().unwrap_or(0) <= r["reorder_level"].as_i64().unwrap_or(0));
        }
        if payload.get("expiringOnly").and_then(serde_json::Value::as_bool).unwrap_or(false) {
            let cutoff = (chrono::Local::now() + chrono::Duration::days(90)).format("%Y-%m-%d").to_string();
            out.retain(|r| r["nearest_expiry"].as_str().map(|e| e <= cutoff.as_str()).unwrap_or(false));
        }
        Ok(json!(out))
    })()
    .map_err(err)
}

#[tauri::command]
pub fn inventory_get(state: State<'_, AppState>, payload: Value) -> Result<Value, String> {
    (|| -> CmdResult<Value> {
        state.gate("inventory_get")?;
        state.need("inventory.view")?;
        let id = util::req_int(payload.get("id").unwrap_or(&Value::Null), "id", 1, i64::MAX)?;
        let conn = state.conn.lock().unwrap();
        let item = util::query_one(&conn, "SELECT i.*, s.name AS supplier_name FROM inventory_items i LEFT JOIN suppliers s ON s.id = i.supplier_id WHERE i.id = ?1", &[&id])?
            .ok_or_else(|| CmdError::new("NOT_FOUND", "Item not found."))?;
        let batches = util::query_all(&conn, "SELECT b.*, s.name AS supplier_name FROM inventory_batches b LEFT JOIN suppliers s ON s.id = b.supplier_id WHERE b.item_id = ?1 ORDER BY b.expiry_date IS NULL, b.expiry_date, b.id", &[&id])?;
        let txns = util::query_all(&conn, "SELECT t.*, u.full_name AS performed_by_name FROM inventory_transactions t LEFT JOIN users u ON u.id = t.performed_by WHERE t.item_id = ?1 ORDER BY t.id DESC LIMIT 200", &[&id])?;
        let mut out = item.clone();
        out["stock"] = json!(stock_balance(&conn, id));
        out["batches"] = json!(batches);
        out["transactions"] = json!(txns);
        Ok(out)
    })()
    .map_err(err)
}

#[tauri::command]
pub fn inventory_save(state: State<'_, AppState>, payload: Value) -> Result<Value, String> {
    (|| -> CmdResult<Value> {
        state.gate("inventory_save")?;
        state.need("inventory.manage")?;
        let name = util::req_text(payload.get("name").unwrap_or(&Value::Null), "Item name", 160)?;
        let sku = util::req_text(payload.get("sku").unwrap_or(&Value::Null), "SKU", 48)?;
        let conn = state.conn.lock().unwrap();
        let category = { let c = util::opt_text(payload.get("category").unwrap_or(&Value::Null), 80); if c.is_empty() { "General".to_string() } else { c } };
        let unit = { let u = util::opt_text(payload.get("unit").unwrap_or(&Value::Null), 24); if u.is_empty() { "pcs".to_string() } else { u } };
        let supplier_id = payload.get("supplierId").and_then(serde_json::Value::as_i64).filter(|n| *n > 0);
        let purchase = util::req_money(payload.get("purchasePricePaisa").unwrap_or(&Value::Null), "purchase price")?;
        let internal = util::req_money(payload.get("internalValuePaisa").unwrap_or(&Value::Null), "internal value")?;
        let reorder = util::req_int(payload.get("reorderLevel").unwrap_or(&json!(0)), "reorder level", 0, 1_000_000)?;
        let expiry_managed = if payload.get("expiryManaged").and_then(serde_json::Value::as_bool).unwrap_or(false) { 1 } else { 0 };
        let notes = util::opt_text(payload.get("notes").unwrap_or(&Value::Null), 2000);
        let active = if payload.get("active").and_then(serde_json::Value::as_bool).unwrap_or(true) { 1 } else { 0 };
        if let Some(id) = util::opt_id(payload.get("id").unwrap_or(&Value::Null)) {
            let dup: i64 = conn.query_row("SELECT COUNT(*) FROM inventory_items WHERE sku = ?1 AND id != ?2", params![sku, id], |r| r.get(0))?;
            if dup > 0 {
                return Err(CmdError::new("DUPLICATE", "SKU already exists."));
            }
            conn.execute("UPDATE inventory_items SET sku = ?1, name = ?2, category = ?3, supplier_id = ?4, unit = ?5, purchase_price_paisa = ?6, internal_value_paisa = ?7, reorder_level = ?8, expiry_managed = ?9, notes = ?10, active = ?11, updated_at = ?12 WHERE id = ?13",
                params![sku, name, category, supplier_id, unit, purchase, internal, reorder, expiry_managed, notes, active, util::now_local(), id])?;
            drop(conn);
            state.audit("inventory.updated", "inventory_item", Some(id), &format!("Inventory item {sku} updated"), None, Some(payload.to_string()));
            return Ok(json!({ "id": id }));
        }
        let dup: i64 = conn.query_row("SELECT COUNT(*) FROM inventory_items WHERE sku = ?1", [&sku], |r| r.get(0))?;
        if dup > 0 {
            return Err(CmdError::new("DUPLICATE", "SKU already exists."));
        }
        conn.execute("INSERT INTO inventory_items (sku, name, category, supplier_id, unit, purchase_price_paisa, internal_value_paisa, reorder_level, expiry_managed, notes, active, created_at, updated_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, 1, ?11, ?11)",
            params![sku, name, category, supplier_id, unit, purchase, internal, reorder, expiry_managed, notes, util::now_local()])?;
        let id = conn.last_insert_rowid();
        drop(conn);
        state.audit("inventory.created", "inventory_item", Some(id), &format!("Inventory item {sku} created"), None, Some(payload.to_string()));
        Ok(json!({ "id": id }))
    })()
    .map_err(err)
}

fn stock_move(state: &AppState, kind: &str, payload: &Value) -> CmdResult<Value> {
    let me = state.need("inventory.manage")?;
    let item_id = util::req_int(
        payload.get("itemId").unwrap_or(&Value::Null),
        "itemId",
        1,
        i64::MAX,
    )?;
    let conn = state.conn.lock().unwrap();
    let item = util::query_one(
        &conn,
        "SELECT * FROM inventory_items WHERE id = ?1",
        &[&item_id],
    )?
    .ok_or_else(|| CmdError::new("NOT_FOUND", "Item not found."))?;
    let reason = if kind == "receive" {
        util::opt_text(
            payload
                .get("reason")
                .unwrap_or(payload.get("note").unwrap_or(&Value::Null)),
            500,
        )
    } else {
        util::req_text(payload.get("reason").unwrap_or(&Value::Null), "reason", 500)?
    };
    let mut batch_id: Option<i64> = None;
    let mut low_stock: Option<i64> = None;
    let now = util::now_local();
    txn(&conn, || {
        if kind == "receive" {
            let qty = util::req_int(
                payload.get("qty").unwrap_or(&Value::Null),
                "qty",
                1,
                1_000_000,
            )?;
            let expiry: Option<String> = if payload.get("expiryDate").is_some()
                && !payload
                    .get("expiryDate")
                    .and_then(serde_json::Value::as_str)
                    .unwrap_or("")
                    .is_empty()
            {
                Some(util::req_date(
                    payload.get("expiryDate").unwrap_or(&Value::Null),
                    "expiryDate",
                )?)
            } else {
                None
            };
            let purchase_date = if payload.get("purchaseDate").is_some()
                && !payload
                    .get("purchaseDate")
                    .and_then(serde_json::Value::as_str)
                    .unwrap_or("")
                    .is_empty()
            {
                util::req_date(
                    payload.get("purchaseDate").unwrap_or(&Value::Null),
                    "purchaseDate",
                )?
            } else {
                util::today()
            };
            conn.execute("INSERT INTO inventory_batches (item_id, batch_no, expiry_date, qty_received, qty_remaining, purchase_price_paisa, supplier_id, purchase_date, notes, created_at) VALUES (?1, ?2, ?3, ?4, ?4, ?5, ?6, ?7, ?8, ?9)",
                params![item_id, util::opt_text(payload.get("batchNo").unwrap_or(&Value::Null), 64), expiry, qty,
                    util::req_money(payload.get("purchasePricePaisa").unwrap_or(&Value::Null), "purchase price")?,
                    payload.get("supplierId").and_then(serde_json::Value::as_i64).filter(|n| *n > 0), purchase_date, util::opt_text(payload.get("note").unwrap_or(&Value::Null), 500), now])?;
            batch_id = Some(conn.last_insert_rowid());
            let bal = stock_balance(&conn, item_id);
            conn.execute("INSERT INTO inventory_transactions (item_id, batch_id, kind, qty_delta, balance_after, reason, ref_type, performed_by, created_at) VALUES (?1, ?2, 'receive', ?3, ?4, ?5, '', ?6, ?7)",
                params![item_id, batch_id, qty, bal, reason, me.id, now])?;
        } else if kind == "issue" {
            let qty = util::req_int(
                payload.get("qty").unwrap_or(&Value::Null),
                "qty",
                1,
                1_000_000,
            )?;
            let batches = util::query_all(&conn, "SELECT * FROM inventory_batches WHERE item_id = ?1 AND qty_remaining > 0 ORDER BY expiry_date IS NULL, expiry_date, id", &[&item_id])?;
            let mut remaining = qty;
            let mut touched: Vec<i64> = Vec::new();
            for b in &batches {
                if remaining <= 0 {
                    break;
                }
                let take = remaining.min(b["qty_remaining"].as_i64().unwrap_or(0));
                conn.execute(
                    "UPDATE inventory_batches SET qty_remaining = qty_remaining - ?1 WHERE id = ?2",
                    params![take, b["id"].as_i64().unwrap_or(0)],
                )?;
                touched.push(b["id"].as_i64().unwrap_or(0));
                remaining -= take;
            }
            if remaining > 0 {
                return Err(CmdError::new(
                    "INSUFFICIENT_STOCK",
                    format!(
                        "Insufficient stock: {} available, {qty} requested.",
                        qty - remaining
                    ),
                ));
            }
            batch_id = touched.first().copied();
            let bal = stock_balance(&conn, item_id);
            conn.execute("INSERT INTO inventory_transactions (item_id, batch_id, kind, qty_delta, balance_after, reason, ref_type, performed_by, created_at) VALUES (?1, ?2, 'issue', ?3, ?4, ?5, '', ?6, ?7)",
                params![item_id, batch_id, -qty, bal, reason, me.id, now])?;
            if bal <= item["reorder_level"].as_i64().unwrap_or(0) {
                low_stock = Some(bal);
            }
        } else {
            let after = util::req_int(
                payload.get("qtyAfter").unwrap_or(&Value::Null),
                "qtyAfter",
                0,
                1_000_000,
            )?;
            let before = stock_balance(&conn, item_id);
            let delta = after - before;
            if delta != 0 {
                let adj_id: i64 = match util::query_one(
                    &conn,
                    "SELECT * FROM inventory_batches WHERE item_id = ?1 AND batch_no = 'ADJUST'",
                    &[&item_id],
                )? {
                    Some(a) => a["id"].as_i64().unwrap_or(0),
                    None => {
                        conn.execute("INSERT INTO inventory_batches (item_id, batch_no, qty_received, qty_remaining, created_at) VALUES (?1, 'ADJUST', 0, 0, ?2)", params![item_id, now])?;
                        conn.last_insert_rowid()
                    }
                };
                conn.execute(
                    "UPDATE inventory_batches SET qty_remaining = qty_remaining + ?1 WHERE id = ?2",
                    params![delta, adj_id],
                )?;
                batch_id = Some(adj_id);
                conn.execute("INSERT INTO stock_adjustments (item_id, batch_id, qty_before, qty_after, reason, performed_by, created_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
                    params![item_id, adj_id, before, after, reason, me.id, now])?;
                conn.execute("INSERT INTO inventory_transactions (item_id, batch_id, kind, qty_delta, balance_after, reason, performed_by, created_at) VALUES (?1, ?2, 'adjust', ?3, ?4, ?5, ?6, ?7)",
                    params![item_id, adj_id, delta, after, reason, me.id, now])?;
            }
        }
        Ok(())
    })?;
    let stock = stock_balance(&conn, item_id);
    let item_name = item["name"].as_str().unwrap_or("").to_string();
    drop(conn);
    if let Some(bal) = low_stock {
        state.notify(
            "warning",
            "inventory",
            "Low stock",
            &format!(
                "{item_name} is at {bal} {} (reorder level {}).",
                item["unit"].as_str().unwrap_or(""),
                item["reorder_level"].as_i64().unwrap_or(0)
            ),
            Some("inventory_item"),
            Some(item_id),
            Some("inventory"),
        );
    }
    state.audit(
        &format!("inventory.{kind}"),
        "inventory_item",
        Some(item_id),
        &format!("Stock {kind} for {item_name}: {reason}"),
        None,
        Some(payload.to_string()),
    );
    Ok(json!({ "itemId": item_id, "batchId": batch_id, "stock": stock }))
}

#[tauri::command]
pub fn stock_receive(state: State<'_, AppState>, payload: Value) -> Result<Value, String> {
    state.gate("stock_receive").map_err(err)?;
    stock_move(&state, "receive", &payload).map_err(err)
}

#[tauri::command]
pub fn stock_issue(state: State<'_, AppState>, payload: Value) -> Result<Value, String> {
    state.gate("stock_issue").map_err(err)?;
    stock_move(&state, "issue", &payload).map_err(err)
}

#[tauri::command]
pub fn stock_adjust(state: State<'_, AppState>, payload: Value) -> Result<Value, String> {
    state.gate("stock_adjust").map_err(err)?;
    stock_move(&state, "adjust", &payload).map_err(err)
}

#[tauri::command]
pub fn suppliers_list(state: State<'_, AppState>, payload: Value) -> Result<Value, String> {
    (|| -> CmdResult<Value> {
        state.gate("suppliers_list")?;
        state.need("inventory.view")?;
        let conn = state.conn.lock().unwrap();
        let q = payload
            .get("search")
            .and_then(serde_json::Value::as_str)
            .unwrap_or("")
            .trim()
            .to_string();
        if q.is_empty() {
            util::query_all(&conn, "SELECT * FROM suppliers ORDER BY name", params!())
                .map(|v| json!(v))
        } else {
            let like = format!("%{q}%");
            util::query_all(
                &conn,
                "SELECT * FROM suppliers WHERE name LIKE ?1 OR phone LIKE ?1 ORDER BY name",
                &[&like],
            )
            .map(|v| json!(v))
        }
    })()
    .map_err(err)
}

#[tauri::command]
pub fn suppliers_save(state: State<'_, AppState>, payload: Value) -> Result<Value, String> {
    (|| -> CmdResult<Value> {
        state.gate("suppliers_save")?;
        state.need("inventory.manage")?;
        let name = util::req_text(payload.get("name").unwrap_or(&Value::Null), "Supplier name", 160)?;
        let conn = state.conn.lock().unwrap();
        let g = |k: &str, m: usize| util::opt_text(payload.get(k).unwrap_or(&Value::Null), m);
        let active = if payload.get("active").and_then(serde_json::Value::as_bool).unwrap_or(true) { 1 } else { 0 };
        if let Some(id) = util::opt_id(payload.get("id").unwrap_or(&Value::Null)) {
            conn.execute("UPDATE suppliers SET name = ?1, phone = ?2, email = ?3, address = ?4, notes = ?5, active = ?6 WHERE id = ?7",
                params![name, g("phone", 48), g("email", 120), g("address", 500), g("notes", 2000), active, id])?;
            drop(conn);
            state.audit("supplier.updated", "supplier", Some(id), &format!("Supplier {name} updated"), None, Some(payload.to_string()));
            return Ok(json!({ "id": id }));
        }
        conn.execute("INSERT INTO suppliers (name, phone, email, address, notes, active, created_at) VALUES (?1, ?2, ?3, ?4, ?5, 1, ?6)",
            params![name, g("phone", 48), g("email", 120), g("address", 500), g("notes", 2000), util::now_local()])?;
        let id = conn.last_insert_rowid();
        drop(conn);
        state.audit("supplier.created", "supplier", Some(id), &format!("Supplier {name} created"), None, Some(payload.to_string()));
        Ok(json!({ "id": id }))
    })()
    .map_err(err)
}

#[tauri::command]
pub fn inventory_alerts(state: State<'_, AppState>) -> Result<Value, String> {
    (|| -> CmdResult<Value> {
        state.gate("inventory_alerts")?;
        state.need("inventory.view")?;
        let conn = state.conn.lock().unwrap();
        let items = util::query_all(&conn, "SELECT i.*, COALESCE((SELECT SUM(qty_remaining) FROM inventory_batches b WHERE b.item_id = i.id), 0) AS stock,
            (SELECT MIN(expiry_date) FROM inventory_batches b WHERE b.item_id = i.id AND b.qty_remaining > 0 AND b.expiry_date IS NOT NULL) AS nearest_expiry
            FROM inventory_items i WHERE i.active = 1", params!())?;
        let cutoff = (chrono::Local::now() + chrono::Duration::days(90)).format("%Y-%m-%d").to_string();
        let today = util::today();
        let low: Vec<Value> = items.iter().filter(|r| r["stock"].as_i64().unwrap_or(0) <= r["reorder_level"].as_i64().unwrap_or(0)).cloned().collect();
        let out: Vec<Value> = items.iter().filter(|r| r["stock"].as_i64().unwrap_or(0) <= 0).cloned().collect();
        let expiring: Vec<Value> = items.iter().filter(|r| r["nearest_expiry"].as_str().map(|e| e >= today.as_str() && e <= cutoff.as_str()).unwrap_or(false)).cloned().collect();
        let expired: Vec<Value> = items.iter().filter(|r| r["nearest_expiry"].as_str().map(|e| e < today.as_str()).unwrap_or(false)).cloned().collect();
        Ok(json!({ "low": low, "out": out, "expiring": expiring, "expired": expired,
            "counts": { "low": low.len(), "out": out.len(), "expiring": expiring.len(), "expired": expired.len() } }))
    })()
    .map_err(err)
}

// ------------------------------------------------------------ accounting
#[tauri::command]
pub fn categories_list(state: State<'_, AppState>, payload: Value) -> Result<Value, String> {
    (|| -> CmdResult<Value> {
        state.gate("categories_list")?;
        let conn = state.conn.lock().unwrap();
        let kind = payload
            .get("kind")
            .and_then(serde_json::Value::as_str)
            .unwrap_or("");
        if kind.is_empty() {
            util::query_all(
                &conn,
                "SELECT * FROM accounting_categories ORDER BY kind, name",
                params!(),
            )
            .map(|v| json!(v))
        } else {
            util::query_all(
                &conn,
                "SELECT * FROM accounting_categories WHERE kind = ?1 ORDER BY name",
                &[&kind],
            )
            .map(|v| json!(v))
        }
    })()
    .map_err(err)
}

#[tauri::command]
pub fn categories_save(state: State<'_, AppState>, payload: Value) -> Result<Value, String> {
    (|| -> CmdResult<Value> {
        state.gate("categories_save")?;
        state.need("accounting.manage")?;
        let kind = payload.get("kind").and_then(serde_json::Value::as_str).unwrap_or("");
        if kind != "income" && kind != "expense" {
            return Err(CmdError::new("VALIDATION", "Category kind must be income or expense."));
        }
        let name = util::req_text(payload.get("name").unwrap_or(&Value::Null), "Category name", 120)?;
        let conn = state.conn.lock().unwrap();
        let desc = util::opt_text(payload.get("description").unwrap_or(&Value::Null), 300);
        let active = if payload.get("active").and_then(serde_json::Value::as_bool).unwrap_or(true) { 1 } else { 0 };
        if let Some(id) = util::opt_id(payload.get("id").unwrap_or(&Value::Null)) {
            conn.execute("UPDATE accounting_categories SET kind = ?1, name = ?2, description = ?3, active = ?4 WHERE id = ?5", params![kind, name, desc, active, id])?;
            drop(conn);
            state.audit("category.updated", "category", Some(id), &format!("Category {name} updated"), None, Some(payload.to_string()));
            return Ok(json!({ "id": id }));
        }
        conn.execute("INSERT INTO accounting_categories (kind, name, description, active) VALUES (?1, ?2, ?3, 1)", params![kind, name, desc])?;
        let id = conn.last_insert_rowid();
        drop(conn);
        state.audit("category.created", "category", Some(id), &format!("Category {name} created"), None, Some(payload.to_string()));
        Ok(json!({ "id": id }))
    })()
    .map_err(err)
}

fn money_entries(
    state: &AppState,
    table: &str,
    payload: &Value,
    list_only: bool,
) -> CmdResult<Value> {
    let date_col = if table == "expenses" {
        "expense_date"
    } else {
        "income_date"
    };
    if list_only {
        state.need("accounting.view")?;
        let conn = state.conn.lock().unwrap();
        let mut conds: Vec<String> = Vec::new();
        let mut args: Vec<String> = Vec::new();
        if let Some(f) = payload.get("from").and_then(serde_json::Value::as_str) {
            if !f.is_empty() {
                conds.push(format!("e.{date_col} >= ?{}", args.len() + 1));
                args.push(f.to_string());
            }
        }
        if let Some(t) = payload.get("to").and_then(serde_json::Value::as_str) {
            if !t.is_empty() {
                conds.push(format!("e.{date_col} <= ?{}", args.len() + 1));
                args.push(t.to_string());
            }
        }
        if let Some(c) = payload
            .get("categoryId")
            .and_then(serde_json::Value::as_i64)
        {
            if c > 0 {
                conds.push(format!("e.category_id = {c}"));
            }
        }
        let w = if conds.is_empty() {
            String::new()
        } else {
            format!("WHERE {}", conds.join(" AND "))
        };
        let refs: Vec<&dyn rusqlite::ToSql> =
            args.iter().map(|v| v as &dyn rusqlite::ToSql).collect();
        return util::query_all(&conn, &format!("SELECT e.*, c.name AS category_name, u.full_name AS created_by_name FROM {table} e LEFT JOIN accounting_categories c ON c.id = e.category_id LEFT JOIN users u ON u.id = e.created_by {w} ORDER BY e.{date_col} DESC, e.id DESC LIMIT 2000"), &refs).map(|v| json!(v));
    }
    let me = state.need("accounting.manage")?;
    if payload
        .get("delete")
        .and_then(serde_json::Value::as_bool)
        .unwrap_or(false)
    {
        let id = util::req_int(payload.get("id").unwrap_or(&Value::Null), "id", 1, i64::MAX)?;
        let conn = state.conn.lock().unwrap();
        let before = util::query_one(
            &conn,
            &format!("SELECT * FROM {table} WHERE id = ?1"),
            &[&id],
        )?;
        conn.execute(&format!("DELETE FROM {table} WHERE id = ?1"), [id])?;
        drop(conn);
        state.audit(
            &format!("{table}.deleted"),
            table,
            Some(id),
            &format!("{table} #{id} deleted"),
            before.map(|b| b.to_string()),
            None,
        );
        return Ok(json!({ "id": id }));
    }
    let amount = util::req_money(payload.get("amountPaisa").unwrap_or(&Value::Null), "amount")?;
    if amount <= 0 {
        return Err(CmdError::new(
            "VALIDATION",
            "Amount must be greater than zero.",
        ));
    }
    let date = util::req_date(payload.get("date").unwrap_or(&json!(util::today())), "date")?;
    let conn = state.conn.lock().unwrap();
    let category_id = payload
        .get("categoryId")
        .and_then(serde_json::Value::as_i64)
        .filter(|n| *n > 0);
    let method = {
        let m = util::opt_text(payload.get("method").unwrap_or(&Value::Null), 32);
        if m.is_empty() {
            "Cash".to_string()
        } else {
            m
        }
    };
    let reference = util::opt_text(payload.get("reference").unwrap_or(&Value::Null), 120);
    let note = util::opt_text(payload.get("note").unwrap_or(&Value::Null), 2000);
    if let Some(id) = util::opt_id(payload.get("id").unwrap_or(&Value::Null)) {
        conn.execute(&format!("UPDATE {table} SET category_id = ?1, amount_paisa = ?2, {date_col} = ?3, method = ?4, reference = ?5, note = ?6 WHERE id = ?7"),
            params![category_id, amount, date, method, reference, note, id])?;
        drop(conn);
        state.audit(
            &format!("{table}.updated"),
            table,
            Some(id),
            &format!("{table} #{id} updated"),
            None,
            Some(payload.to_string()),
        );
        return Ok(json!({ "id": id }));
    }
    conn.execute(&format!("INSERT INTO {table} (category_id, amount_paisa, {date_col}, method, reference, note, created_by, created_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)"),
        params![category_id, amount, date, method, reference, note, me.id, util::now_local()])?;
    let id = conn.last_insert_rowid();
    drop(conn);
    state.audit(
        &format!("{table}.created"),
        table,
        Some(id),
        &format!("{table} #{id} recorded ({amount} paisa)"),
        None,
        Some(payload.to_string()),
    );
    Ok(json!({ "id": id }))
}

#[tauri::command]
pub fn expenses_list(state: State<'_, AppState>, payload: Value) -> Result<Value, String> {
    state.gate("expenses_list").map_err(err)?;
    money_entries(&state, "expenses", &payload, true).map_err(err)
}

#[tauri::command]
pub fn expenses_save(state: State<'_, AppState>, payload: Value) -> Result<Value, String> {
    state.gate("expenses_save").map_err(err)?;
    money_entries(&state, "expenses", &payload, false).map_err(err)
}

#[tauri::command]
pub fn incomes_list(state: State<'_, AppState>, payload: Value) -> Result<Value, String> {
    state.gate("incomes_list").map_err(err)?;
    money_entries(&state, "income_records", &payload, true).map_err(err)
}

#[tauri::command]
pub fn incomes_save(state: State<'_, AppState>, payload: Value) -> Result<Value, String> {
    state.gate("incomes_save").map_err(err)?;
    money_entries(&state, "income_records", &payload, false).map_err(err)
}

#[tauri::command]
pub fn accounting_summary(state: State<'_, AppState>, payload: Value) -> Result<Value, String> {
    (|| -> CmdResult<Value> {
        state.gate("accounting_summary")?;
        state.need("accounting.view")?;
        let conn = state.conn.lock().unwrap();
        let from = payload.get("from").and_then(serde_json::Value::as_str).unwrap_or("2000-01-01");
        let to = payload.get("to").and_then(serde_json::Value::as_str).unwrap_or("2100-01-01");
        let income: i64 = conn.query_row("SELECT COALESCE(SUM(amount_paisa),0) FROM income_records WHERE income_date BETWEEN ?1 AND ?2", params![from, to], |r| r.get(0)).unwrap_or(0);
        let expense: i64 = conn.query_row("SELECT COALESCE(SUM(amount_paisa),0) FROM expenses WHERE expense_date BETWEEN ?1 AND ?2", params![from, to], |r| r.get(0)).unwrap_or(0);
        let by_category = util::query_all(&conn, "SELECT c.name, c.kind, SUM(e.amount_paisa) AS total FROM expenses e LEFT JOIN accounting_categories c ON c.id = e.category_id WHERE e.expense_date BETWEEN ?1 AND ?2 GROUP BY c.name UNION ALL SELECT c.name, c.kind, SUM(e.amount_paisa) FROM income_records e LEFT JOIN accounting_categories c ON c.id = e.category_id WHERE e.income_date BETWEEN ?1 AND ?2 GROUP BY c.name", &[&from, &to, &from, &to])?;
        let by_method = util::query_all(&conn, "SELECT method, 'expense' AS kind, SUM(amount_paisa) AS total FROM expenses WHERE expense_date BETWEEN ?1 AND ?2 GROUP BY method UNION ALL SELECT method, 'income', SUM(amount_paisa) FROM income_records WHERE income_date BETWEEN ?1 AND ?2 GROUP BY method", &[&from, &to, &from, &to])?;
        let receivables: i64 = conn.query_row("SELECT COALESCE(SUM(total_paisa - paid_paisa),0) FROM invoices WHERE status IN ('Due','Partially Paid')", (), |r| r.get(0)).unwrap_or(0);
        Ok(json!({ "income": income, "expense": expense, "net": income - expense, "byCategory": by_category, "byMethod": by_method, "receivables": receivables }))
    })()
    .map_err(err)
}
