// Dentiva Pro — coded errors. Serialised as "CODE: message" so the frontend
// can map them to friendly UI text (see src/lib/ipc.ts CommandError).

#[derive(Debug)]
pub struct CmdError {
    pub code: &'static str,
    pub message: String,
}

impl CmdError {
    pub fn new(code: &'static str, message: impl Into<String>) -> Self {
        Self { code, message: message.into() }
    }
}

impl std::fmt::Display for CmdError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(f, "{}: {}", self.code, self.message)
    }
}

// Tauri requires command error types to be Serialize. We serialise as the
// plain "CODE: message" string so the frontend keeps its existing parsing.
impl serde::Serialize for CmdError {
    fn serialize<S: serde::Serializer>(&self, serializer: S) -> Result<S::Ok, S::Error> {
        serializer.serialize_str(&self.to_string())
    }
}

impl From<rusqlite::Error> for CmdError {
    fn from(e: rusqlite::Error) -> Self {
        let msg = e.to_string();
        if msg.contains("UNIQUE constraint failed") {
            return Self::new("DUPLICATE", "This record already exists (duplicate value).");
        }
        if msg.contains("FOREIGN KEY constraint failed") {
            return Self::new("FK_VIOLATION", "This operation would break linked records and was refused.");
        }
        Self::new("DB", format!("Database error: {msg}"))
    }
}

impl From<std::io::Error> for CmdError {
    fn from(e: std::io::Error) -> Self {
        Self::new("IO", format!("File error: {e}"))
    }
}

impl From<serde_json::Error> for CmdError {
    fn from(e: serde_json::Error) -> Self {
        Self::new("INVALID_BACKUP", format!("Invalid backup data: {e}"))
    }
}

impl From<base64::DecodeError> for CmdError {
    fn from(e: base64::DecodeError) -> Self {
        Self::new("INVALID_DATA", format!("Invalid encoded data: {e}"))
    }
}

pub type CmdResult<T> = Result<T, CmdError>;
