//! CLI error type shared by argument parsing, HTTP calls, and file handling.

use std::fmt;

/// An error that ends the process with a readable `CODE: message` line.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct CliError {
    pub code: String,
    pub message: String,
    pub hint: Option<String>,
    pub exit_code: u8,
}

impl CliError {
    #[must_use]
    pub fn usage(message: impl Into<String>) -> Self {
        Self { code: "USAGE".into(), message: message.into(), hint: None, exit_code: 2 }
    }

    #[must_use]
    pub fn runtime(code: impl Into<String>, message: impl Into<String>) -> Self {
        Self { code: code.into(), message: message.into(), hint: None, exit_code: 1 }
    }

    #[must_use]
    pub fn with_hint(mut self, hint: impl Into<String>) -> Self {
        self.hint = Some(hint.into());
        self
    }

    #[must_use]
    pub fn to_json(&self) -> serde_json::Value {
        let mut value = serde_json::json!({
            "ok": false,
            "error": { "code": self.code, "message": self.message }
        });
        if let Some(hint) = &self.hint {
            value["error"]["hint"] = serde_json::Value::String(hint.clone());
        }
        value
    }
}

impl fmt::Display for CliError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(f, "{}: {}", self.code, self.message)?;
        if let Some(hint) = &self.hint {
            write!(f, "\nhint: {hint}")?;
        }
        Ok(())
    }
}

impl std::error::Error for CliError {}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn usage_errors_exit_with_two() {
        let error = CliError::usage("bad");
        assert_eq!(error.exit_code, 2);
        assert_eq!(error.code, "USAGE");
        assert_eq!(error.to_string(), "USAGE: bad");
    }

    #[test]
    fn hints_are_rendered_and_serialized() {
        let error = CliError::runtime("NO_UI_CLIENT", "nobody").with_hint("open the app");
        assert_eq!(error.to_string(), "NO_UI_CLIENT: nobody\nhint: open the app");
        let json = error.to_json();
        assert_eq!(json["error"]["code"], "NO_UI_CLIENT");
        assert_eq!(json["error"]["hint"], "open the app");
    }
}
