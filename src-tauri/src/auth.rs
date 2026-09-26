// Dentiva Pro — password hashing (Argon2id, production native backend).

use argon2::{
    password_hash::{rand_core::OsRng, PasswordHash, PasswordHasher, PasswordVerifier, SaltString},
    Argon2,
};

use crate::error::{CmdError, CmdResult};

pub fn hash_password(password: &str) -> CmdResult<String> {
    if password.len() < 8 {
        return Err(CmdError::new("VALIDATION", "Password must be at least 8 characters."));
    }
    let salt = SaltString::generate(&mut OsRng);
    Argon2::default()
        .hash_password(password.as_bytes(), &salt)
        .map(|h| h.to_string())
        .map_err(|e| CmdError::new("AUTH", format!("Password hashing failed: {e}")))
}

pub fn verify_password(password: &str, stored: &str) -> bool {
    // Native backend verifies Argon2id hashes. PBKDF2 hashes (created only by
    // the web-preview fallback) are not accepted by the desktop build.
    if !stored.starts_with("$argon2") {
        return false;
    }
    let Ok(parsed) = PasswordHash::new(stored) else {
        return false;
    };
    Argon2::default().verify_password(password.as_bytes(), &parsed).is_ok()
}
