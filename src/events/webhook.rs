#![allow(
    clippy::unwrap_used,
    clippy::expect_used,
    clippy::too_many_lines,
    clippy::unused_self,
    clippy::missing_errors_doc,
    clippy::format_push_string
)]
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::Arc;
use tracing::{error, info};

use super::{BusEvent, EventBus};
use crate::settings::config_dir;
use crate::util::chrono_now;

/// Webhook configuration (stored in settings.json).
#[derive(Clone, Serialize, Deserialize, Debug)]
pub struct WebhookConfig {
    pub url: String,
    pub events: Vec<String>,
    #[serde(default)]
    pub secret_ref: Option<String>,
    #[serde(default = "default_true")]
    pub enabled: bool,
}

fn default_true() -> bool {
    true
}

/// Secret storage entry.
#[derive(Serialize, Deserialize)]
struct SecretsFile(HashMap<String, String>);

fn secrets_path() -> PathBuf {
    config_dir().join("secrets.json")
}

fn load_secrets() -> HashMap<String, String> {
    let path = secrets_path();
    if !path.exists() {
        return HashMap::new();
    }
    match std::fs::read_to_string(&path) {
        Ok(data) => serde_json::from_str::<SecretsFile>(&data).map(|s| s.0).unwrap_or_default(),
        Err(_) => HashMap::new(),
    }
}

fn save_secrets(secrets: &HashMap<String, String>) -> Result<(), String> {
    let dir = config_dir();
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    let json =
        serde_json::to_string_pretty(&SecretsFile(secrets.clone())).map_err(|e| e.to_string())?;
    std::fs::write(secrets_path(), json).map_err(|e| e.to_string())?;
    let _ = crate::platform::fs::set_private_file_permissions(&secrets_path());
    Ok(())
}

/// Compute HMAC-SHA256 signature.
fn hmac_sha256(secret: &[u8], message: &[u8]) -> String {
    use hmac::{Hmac, Mac};
    use sha2::Sha256;
    type HmacSha256 = Hmac<Sha256>;
    let mut mac = HmacSha256::new_from_slice(secret).expect("HMAC accepts any key length");
    mac.update(message);
    let result = mac.finalize();
    let bytes = result.into_bytes();
    let mut hex = String::with_capacity(bytes.len() * 2);
    for b in &bytes {
        use std::fmt::Write;
        let _ = write!(hex, "{b:02x}");
    }
    format!("sha256={hex}")
}

pub struct WebhookDispatcher {
    secrets: HashMap<String, String>,
    configs: Vec<WebhookConfig>,
}

pub type WebhookState = Arc<WebhookDispatcher>;

impl WebhookDispatcher {
    #[must_use]
    pub fn new(configs: Vec<WebhookConfig>) -> Self {
        let secrets = load_secrets();
        info!("Loaded {} webhook configs, {} secrets", configs.len(), secrets.len());
        Self { secrets, configs }
    }

    /// Store a secret for a webhook.
    pub fn set_secret(&mut self, ref_name: &str, secret: &str) -> Result<(), String> {
        self.secrets.insert(ref_name.to_string(), secret.to_string());
        save_secrets(&self.secrets)
    }

    /// Dispatch an event to all matching webhooks.
    pub fn dispatch(&self, event: &BusEvent) {
        let event_name = match event {
            BusEvent::CommandFinished { .. } => "command_finished",
            BusEvent::SessionCreated { .. } => "session_created",
            BusEvent::SessionClosed { .. } => "session_closed",
            BusEvent::TabCreated { .. } => "tab_created",
            BusEvent::TabClosed { .. } => "tab_closed",
            BusEvent::FileChanged { .. } => "file_changed",
            BusEvent::Custom { .. } => "custom",
            BusEvent::AuthLoginFailed { .. } => "auth_login_failed",
            BusEvent::VerificationCode { .. } => "auth_verification_code",
            BusEvent::VerificationCodeConsumed { .. } => "auth_verification_code_consumed",
            BusEvent::Notify { .. } => "notify",
            BusEvent::ProcessExited { .. } => "process_exited",
            BusEvent::PluginChanged { .. } => "plugin_changed",
        };

        for config in &self.configs {
            if !config.enabled {
                continue;
            }
            if !config.events.iter().any(|e| e == event_name || e == "*") {
                continue;
            }

            let url = config.url.clone();
            let payload = serde_json::json!({
                "event": event_name,
                "timestamp": chrono_now(),
                "data": event,
            });
            let payload_bytes = serde_json::to_vec(&payload).unwrap_or_default();

            // Compute signature if secret is configured
            let signature = config.secret_ref.as_ref().and_then(|ref_name| {
                self.secrets
                    .get(ref_name)
                    .map(|secret| hmac_sha256(secret.as_bytes(), &payload_bytes))
            });

            // Fire-and-forget HTTP POST
            tokio::spawn(async move {
                let client = reqwest::Client::new();
                let mut req = client
                    .post(&url)
                    .header("Content-Type", "application/json")
                    .header("User-Agent", "dinotty-webhook/1.0")
                    .body(payload_bytes);

                if let Some(sig) = signature {
                    req = req.header("X-Dinotty-Signature", sig);
                }

                match req.send().await {
                    Ok(resp) => {
                        if !resp.status().is_success() {
                            error!("Webhook {} returned status {}", url, resp.status());
                        }
                    }
                    Err(e) => {
                        error!("Webhook {} failed: {}", url, e);
                    }
                }
            });
        }
    }

    /// Start listening to the event bus and dispatching webhooks.
    pub fn start(self: &Arc<Self>, event_bus: &EventBus) {
        let dispatcher = Arc::clone(self);
        let mut rx = event_bus.subscribe();
        tokio::spawn(async move {
            while let Ok(event) = rx.recv().await {
                dispatcher.dispatch(&event);
            }
        });
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_webhook_config_deserialize() {
        let json = r#"{"url": "https://example.com/hook", "events": ["command_finished"], "enabled": true}"#;
        let config: WebhookConfig = serde_json::from_str(json).unwrap();
        assert_eq!(config.url, "https://example.com/hook");
        assert!(config.enabled);
    }

    #[test]
    fn test_hmac_sha256() {
        let sig = hmac_sha256(b"secret", b"message");
        assert!(sig.starts_with("sha256="));
    }
}
