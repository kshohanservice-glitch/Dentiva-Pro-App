// Dentiva Pro — Tauri 2 application entry (native desktop backend).

mod activation;
mod auth;
mod commands;
mod ctx;
mod db;
mod error;
mod util;

use std::sync::Mutex;
use tauri::Manager;

use ctx::AppState;

fn load_or_create_install_id(paths: &db::Paths) -> String {
    if let Ok(existing) = std::fs::read_to_string(&paths.install_id_path) {
        let trimmed = existing.trim().to_string();
        if !trimmed.is_empty() {
            return trimmed;
        }
    }
    let id = uuid::Uuid::new_v4().to_string();
    let _ = std::fs::write(&paths.install_id_path, format!("{id}\n"));
    id
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .setup(|app| {
            let app_data = app.path().app_data_dir().map_err(|e| e.to_string())?;
            let paths = db::resolve_paths(app_data);
            std::fs::create_dir_all(&paths.data_dir).map_err(|e| e.to_string())?;
            std::fs::create_dir_all(&paths.attachments_dir).map_err(|e| e.to_string())?;
            std::fs::create_dir_all(&paths.backups_dir).map_err(|e| e.to_string())?;
            let install_id = load_or_create_install_id(&paths);
            let conn = db::open_connection(&paths.db_path).map_err(|e| e.to_string())?;
            db::ensure_schema(&conn).map_err(|e| e.to_string())?;
            app.manage(AppState {
                conn: Mutex::new(conn),
                paths,
                install_id,
                session: Mutex::new(None),
                locked: Mutex::new(false),
            });
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            // system: status / activation / setup / auth / settings
            commands::app_status,
            commands::activate,
            commands::setup_init,
            commands::login,
            commands::logout,
            commands::lock_app,
            commands::unlock,
            commands::change_password,
            commands::settings_get,
            commands::settings_set,
            commands::dashboard_stats,
            commands::global_search,
            commands::notifications_list,
            commands::notifications_mark,
            commands::notifications_clear,
            commands::notifications_refresh,
            commands::audit_list,
            commands::backup_run,
            commands::backup_list,
            commands::restore_validate,
            commands::restore_run,
            commands::report_run,
            commands::data_export,
            commands::data_reset,
            commands::logo_save,
            commands::logo_get,
            // patients
            commands::patients_list,
            commands::patients_get,
            commands::patients_create,
            commands::patients_update,
            commands::patients_delete,
            commands::patients_merge,
            commands::patient_timeline,
            commands::patient_financials,
            commands::mednotes_list,
            commands::mednotes_create,
            commands::attachments_list,
            commands::attachment_upload,
            commands::attachment_get,
            commands::attachment_delete,
            // clinical
            commands::visits_list,
            commands::visits_create,
            commands::visits_update,
            commands::visits_delete,
            commands::chart_get,
            commands::chart_set,
            commands::treatments_list,
            commands::treatments_save,
            commands::treatment_records_create,
            commands::medications_list,
            commands::medications_save,
            commands::prescriptions_list,
            commands::prescriptions_get,
            commands::prescriptions_save,
            commands::prescriptions_delete,
            commands::appointments_list,
            commands::appointments_save,
            commands::appointments_delete,
            commands::queue_list,
            commands::queue_add,
            commands::queue_action,
            commands::referrals_list,
            commands::referrals_save,
            commands::referrals_delete,
            // finance
            commands::invoices_list,
            commands::invoices_get,
            commands::invoices_save,
            commands::invoices_delete,
            commands::payments_list,
            commands::payments_create,
            commands::payments_reverse,
            commands::inventory_list,
            commands::inventory_get,
            commands::inventory_save,
            commands::stock_receive,
            commands::stock_issue,
            commands::stock_adjust,
            commands::suppliers_list,
            commands::suppliers_save,
            commands::inventory_alerts,
            commands::categories_list,
            commands::categories_save,
            commands::expenses_list,
            commands::expenses_save,
            commands::incomes_list,
            commands::incomes_save,
            commands::accounting_summary,
            // admin
            commands::staff_list,
            commands::staff_save,
            commands::staff_delete,
            commands::users_list,
            commands::users_save,
            commands::users_delete,
            commands::roles_list,
            commands::roles_save,
            commands::roles_delete,
            commands::clinic_get,
            commands::clinic_update,
            commands::dentists_list,
            commands::dentists_save,
            commands::dentists_delete,
            commands::printer_profiles_list,
            commands::printer_profiles_save,
        ])
        .run(tauri::generate_context!())
        .expect("failed to run Dentiva Pro");
}
