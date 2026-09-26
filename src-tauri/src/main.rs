// Dentiva Pro — Windows entry point. Console hidden in release builds.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    dentiva_pro_lib::run()
}
