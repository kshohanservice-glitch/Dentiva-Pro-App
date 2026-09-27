// Dentiva Pro — one-time activation verification (native backend).
//
// The activation secret itself is NEVER embedded here. Only a one-way derived
// verifier (SHA-256 over a domain-separated preimage) is embedded, assembled
// from parts at runtime to resist casual string searching. See
// src/backend/activation.ts for the documented security model.

use sha2::{Digest, Sha256};

// Domain separation tag for the activation verifier preimage.
const DOMAIN: &str = "dentiva-pro::activation::v1::";

// Derived verifier (SHA-256 digest, base64, assembled from parts at runtime).
const V_A: &str = "r9WfGmNglyXU1sGsIw9s+B";
const V_B: &str = "gezIfXTQjwUVN5vQT52Q0=";

fn expected_hex() -> String {
    use base64::Engine;
    let joined = format!("{V_A}{V_B}");
    let bytes = base64::engine::general_purpose::STANDARD
        .decode(joined.as_bytes())
        .unwrap_or_default();
    bytes.iter().map(|b| format!("{b:02x}")).collect()
}

fn sha256_hex(text: &str) -> String {
    let mut h = Sha256::new();
    h.update(text.as_bytes());
    format!("{:x}", h.finalize())
}

fn timing_safe_equal(a: &str, b: &str) -> bool {
    if a.len() != b.len() {
        return false;
    }
    let mut diff = 0u8;
    for (x, y) in a.bytes().zip(b.bytes()) {
        diff |= x ^ y;
    }
    diff == 0
}

/// Returns true only when `code` derives to the embedded verifier.
pub fn verify_activation_code(code: &str) -> bool {
    let candidate = code.trim();
    if candidate.len() < 8 || candidate.len() > 32 || !candidate.bytes().all(|b| b.is_ascii_digit())
    {
        return false;
    }
    let digest = sha256_hex(&format!("{DOMAIN}{candidate}"));
    timing_safe_equal(&digest, &expected_hex())
}

/// Device-bound activation receipt stored after successful activation.
pub fn activation_receipt(install_id: &str) -> String {
    sha256_hex(&format!("{}::{install_id}", expected_hex()))
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn rejects_wrong_codes() {
        assert!(!verify_activation_code(""));
        assert!(!verify_activation_code("123"));
        assert!(!verify_activation_code("000000000000007"));
    }
}
