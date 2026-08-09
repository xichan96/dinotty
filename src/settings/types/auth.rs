use serde::{Deserialize, Serialize};

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct AuthConfig {
    #[serde(default)]
    pub allowed_origins: Vec<String>,
    #[serde(default)]
    pub trusted_proxies: Vec<String>,
    #[serde(default = "default_lockout_strategy")]
    pub lockout_strategy: String,
    #[serde(default = "default_session_ttl_days")]
    pub session_ttl_days: u64,
    #[serde(default = "default_lockout_max_failures")]
    pub lockout_max_failures: u32,
    #[serde(default = "default_lockout_secs")]
    pub lockout_secs: u64,
    #[serde(default = "default_global_lockout_max_failures")]
    pub global_lockout_max_failures: u32,
    #[serde(default = "default_global_lockout_secs")]
    pub global_lockout_secs: u64,
    #[serde(default = "default_login_method")]
    pub login_method: String,
    #[serde(default = "default_verification_code_ttl_seconds")]
    pub verification_code_ttl_seconds: u64,
    #[serde(default = "default_verification_code_rate_limit_per_minute")]
    pub verification_code_rate_limit_per_minute: u32,
}

impl Default for AuthConfig {
    fn default() -> Self {
        Self {
            allowed_origins: vec![],
            trusted_proxies: vec![],
            lockout_strategy: default_lockout_strategy(),
            session_ttl_days: default_session_ttl_days(),
            lockout_max_failures: default_lockout_max_failures(),
            lockout_secs: default_lockout_secs(),
            global_lockout_max_failures: default_global_lockout_max_failures(),
            global_lockout_secs: default_global_lockout_secs(),
            login_method: default_login_method(),
            verification_code_ttl_seconds: default_verification_code_ttl_seconds(),
            verification_code_rate_limit_per_minute:
                default_verification_code_rate_limit_per_minute(),
        }
    }
}

pub(crate) fn default_lockout_strategy() -> String {
    "ip".into()
}

pub(crate) fn default_session_ttl_days() -> u64 {
    7
}

pub(crate) fn default_lockout_max_failures() -> u32 {
    5
}

pub(crate) fn default_lockout_secs() -> u64 {
    60
}

pub(crate) fn default_global_lockout_max_failures() -> u32 {
    50
}

pub(crate) fn default_global_lockout_secs() -> u64 {
    300
}

pub(crate) fn default_login_method() -> String {
    "token".into()
}

pub(crate) fn default_verification_code_ttl_seconds() -> u64 {
    300
}

pub(crate) fn default_verification_code_rate_limit_per_minute() -> u32 {
    5
}

#[derive(Serialize, Deserialize, Clone, Debug, Default)]
pub struct PreviewConfig {
    #[serde(default = "default_preview_allow_external")]
    pub allow_external: bool,
}

pub(crate) fn default_preview_allow_external() -> bool {
    true
}

#[derive(Serialize, Deserialize, Clone, Debug, Default)]
pub struct PluginPrefsConfig {
    #[serde(default)]
    pub hidden_toolbar: Vec<String>,
    #[serde(default)]
    pub show_incompatible: bool,
}
