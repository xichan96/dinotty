mod action;
mod auth;
mod bookmarks;
mod notification;
mod ssh;
mod text;
mod theme;

pub use action::*;
pub use auth::*;
pub use bookmarks::*;
pub use notification::*;
pub use ssh::*;
pub use text::*;
pub use theme::*;

use serde::{Deserialize, Serialize};
use std::sync::Arc;
use tokio::sync::RwLock;

pub const CURRENT_SETTINGS_VERSION: u32 = 7;
pub(crate) const LEGACY_UPLOAD_DIR: &str = "~/.dinotty/uploads";

#[derive(Serialize, Clone, Copy, Debug, Default, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum KeyboardGuardMode {
    #[default]
    Off,
    CollapseOnly,
    OpenOnly,
    Both,
}

impl<'de> Deserialize<'de> for KeyboardGuardMode {
    fn deserialize<D>(deserializer: D) -> Result<Self, D::Error>
    where
        D: serde::Deserializer<'de>,
    {
        let value = serde_json::Value::deserialize(deserializer)?;
        Ok(match value.as_str() {
            Some("collapse_only") => Self::CollapseOnly,
            Some("open_only") => Self::OpenOnly,
            Some("both") => Self::Both,
            _ => Self::Off,
        })
    }
}

fn tolerant_legacy_bool<'de, D>(deserializer: D) -> Result<bool, D::Error>
where
    D: serde::Deserializer<'de>,
{
    let value = serde_json::Value::deserialize(deserializer)?;
    Ok(value.as_bool().unwrap_or(false))
}

#[derive(Serialize, Deserialize, Clone, Copy, Debug, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum WorkspaceBadgeMode {
    Off,
    Tab,
    Icon,
    Both,
}

#[derive(Serialize, Deserialize, Clone, Copy, Debug, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum MobileInputMode {
    Builtin,
    System,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
#[allow(clippy::struct_excessive_bools)]
pub struct Settings {
    #[serde(default)]
    pub settings_version: u32,
    #[serde(default)]
    pub theme: ThemeConfig,
    #[serde(default)]
    pub background: BackgroundConfig,
    #[serde(default)]
    pub text: TextConfig,
    #[serde(default)]
    pub bookmarks: Vec<CommandBookmark>,
    #[serde(default)]
    pub workspace_bookmarks: Vec<WorkspaceBookmark>,
    #[serde(default)]
    pub web_bookmarks: Vec<WebBookmark>,
    #[serde(default)]
    pub recent_files: Vec<RecentEntry>,
    #[serde(default)]
    pub recent_urls: Vec<RecentEntry>,
    #[serde(default)]
    pub action_keyboard: Option<ActionKeyboardConfig>,
    #[serde(default)]
    pub action_keyboard_user_default: Option<ActionKeyboardConfig>,
    #[serde(default = "default_upload_dir")]
    pub upload_dir: String,
    #[serde(default)]
    pub default_base_dir: Option<String>,
    #[serde(default)]
    pub default_workspace_root: Option<String>,
    #[serde(default)]
    pub default_workspace_name: Option<String>,
    #[serde(default)]
    pub default_workspace_abbr: Option<String>,
    #[serde(default)]
    pub default_workspace_color: Option<String>,
    #[serde(default)]
    pub default_workspace_tab_badge: Option<bool>,
    #[serde(default = "default_upload_cap_mb")]
    pub upload_cap_mb: u64,
    #[serde(default = "default_upload_cap_count")]
    pub upload_cap_count: u32,
    #[serde(default)]
    pub upload_file_cap_mb: u64,
    #[serde(default)]
    pub toolbar_quick_keys: Vec<ActionKey>,
    #[serde(default)]
    pub keyboard_sound: bool,
    #[serde(default = "default_quick_send_threshold")]
    pub quick_send_threshold: u32,
    #[serde(default)]
    pub show_virtual_keyboard: bool,
    #[serde(default)]
    pub mobile_input_mode: Option<MobileInputMode>,
    #[serde(default)]
    pub keyboard_guard_mode: KeyboardGuardMode,
    // Legacy v6 input retained only so v7 migration can deserialize it.
    #[serde(default, deserialize_with = "tolerant_legacy_bool", skip_serializing)]
    pub keyboard_keep_on_scroll: bool,
    // Legacy v4 input retained only so v5 migration can deserialize it.
    #[serde(default, skip_serializing)]
    pub show_workspace_badge_on_tab: Option<bool>,
    #[serde(default)]
    pub workspace_badge_mode: Option<WorkspaceBadgeMode>,
    #[serde(default, rename = "windowsAltAsCmd")]
    pub windows_alt_as_cmd: bool,
    #[serde(default = "default_true")]
    pub confirm_before_close_tab: bool,
    #[serde(default = "default_true")]
    pub restore_session_on_startup: bool,
    #[serde(default)]
    pub reload_after_supervise_tabs: bool,
    #[serde(default)]
    pub space_confirms_dialogs: bool,
    #[serde(default = "default_locale")]
    pub locale: String,
    #[serde(default = "default_true")]
    pub auto_check_updates: bool,
    #[serde(default)]
    pub panel_position: PanelPosition,
    #[serde(default)]
    pub monitor: MonitorConfig,
    #[serde(default)]
    pub notification: NotificationConfig,
    #[serde(default)]
    pub open_api: OpenApiConfig,
    #[serde(skip)]
    pub auth_token: String,
    #[serde(default = "default_ip_whitelist")]
    pub ip_whitelist: Vec<String>,
    #[serde(default)]
    pub keybindings: std::collections::HashMap<String, KeyBinding>,
    #[serde(default)]
    pub log: LogConfig,
    #[serde(default)]
    pub ssh_profiles: Vec<SshProfile>,
    #[serde(default)]
    pub active_workspace_id: Option<String>,
    #[serde(default)]
    pub auth: AuthConfig,
    #[serde(default)]
    pub preview: PreviewConfig,
    #[serde(default)]
    pub custom_themes: Vec<SavedTheme>,
    #[serde(default)]
    pub hidden_builtins: Vec<String>,
    #[serde(default)]
    pub plugin_prefs: PluginPrefsConfig,
    #[serde(default = "default_shell_kind")]
    pub shell: String,
    #[serde(default)]
    pub shell_path: Option<String>,
    #[serde(default)]
    pub wsl_distro: Option<String>,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
#[allow(clippy::struct_excessive_bools)]
pub struct KeyBinding {
    pub key: String,
    #[serde(default)]
    pub shift: bool,
    #[serde(default, skip_serializing_if = "is_false")]
    pub meta: bool,
    #[serde(default, skip_serializing_if = "is_false")]
    pub ctrl: bool,
    #[serde(default, skip_serializing_if = "is_false")]
    pub alt: bool,
}

#[allow(clippy::trivially_copy_pass_by_ref)]
pub(crate) fn is_false(b: &bool) -> bool {
    !*b
}

#[derive(Serialize, Deserialize, Clone, Debug, Default)]
pub struct OpenApiConfig {
    #[serde(default)]
    pub enabled: bool,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct LogConfig {
    #[serde(default)]
    pub enabled: bool,
    #[serde(default)]
    pub path: String,
    #[serde(default = "default_log_max_size")]
    pub max_size_mb: u64,
}

impl Default for LogConfig {
    fn default() -> Self {
        Self { enabled: true, path: String::new(), max_size_mb: 50 }
    }
}

pub(crate) fn default_log_max_size() -> u64 {
    50
}

#[derive(Serialize, Deserialize, Clone, Debug)]
#[allow(clippy::struct_excessive_bools)]
pub struct MonitorConfig {
    #[serde(default = "default_true")]
    pub enabled: bool,
    #[serde(default = "default_true")]
    pub cpu: bool,
    #[serde(default = "default_true")]
    pub memory: bool,
    #[serde(default = "default_true")]
    pub disk: bool,
    #[serde(default = "default_true")]
    pub network: bool,
    #[serde(default = "default_true")]
    pub gpu: bool,
    /// Per-plugin-series visibility overrides. Keyed by series id.
    /// Absent key falls back to the series' `defaultVisible`.
    #[serde(default)]
    pub plugin_series: std::collections::HashMap<String, bool>,
}

impl Default for MonitorConfig {
    fn default() -> Self {
        Self {
            enabled: true,
            cpu: true,
            memory: true,
            disk: true,
            network: true,
            gpu: true,
            plugin_series: std::collections::HashMap::new(),
        }
    }
}

pub(crate) fn default_ip_whitelist() -> Vec<String> {
    // Server mode: no loopback bypass by default - local access must
    // authenticate, preventing SSH port-forwarding bypass. Desktop mode keeps
    // loopback bypass for Tauri zero-config.
    if cfg!(feature = "server") {
        vec![]
    } else {
        vec!["127.0.0.1".into(), "::1".into()]
    }
}

pub(crate) fn default_locale() -> String {
    "zh".into()
}

pub(crate) fn default_shell_kind() -> String {
    "auto".into()
}

#[must_use]
pub fn default_upload_dir() -> String {
    if cfg!(windows) {
        "%TEMP%\\dinotty".to_string()
    } else {
        "$TMPDIR/dinotty".to_string()
    }
}

pub(crate) fn default_upload_cap_mb() -> u64 {
    200
}

pub(crate) fn default_upload_cap_count() -> u32 {
    100
}

pub(crate) fn default_quick_send_threshold() -> u32 {
    63
}

pub(crate) fn default_true() -> bool {
    true
}

#[derive(Serialize, Deserialize, Clone, Debug, Default)]
#[serde(rename_all = "lowercase")]
pub enum PanelPosition {
    #[default]
    Auto,
    Left,
    Right,
    Top,
    Bottom,
}

impl Default for Settings {
    fn default() -> Self {
        Self {
            settings_version: CURRENT_SETTINGS_VERSION,
            theme: ThemeConfig::default(),
            background: BackgroundConfig::default(),
            text: TextConfig::default(),
            bookmarks: vec![],
            workspace_bookmarks: vec![],
            web_bookmarks: vec![],
            recent_files: vec![],
            recent_urls: vec![],
            action_keyboard: None,
            action_keyboard_user_default: None,
            toolbar_quick_keys: vec![],
            upload_dir: default_upload_dir(),
            default_base_dir: None,
            default_workspace_root: None,
            default_workspace_name: None,
            default_workspace_abbr: None,
            default_workspace_color: None,
            default_workspace_tab_badge: None,
            upload_cap_mb: default_upload_cap_mb(),
            upload_cap_count: default_upload_cap_count(),
            upload_file_cap_mb: 0,
            keyboard_sound: false,
            quick_send_threshold: default_quick_send_threshold(),
            show_virtual_keyboard: false,
            mobile_input_mode: None,
            keyboard_guard_mode: KeyboardGuardMode::default(),
            keyboard_keep_on_scroll: false,
            show_workspace_badge_on_tab: None,
            workspace_badge_mode: None,
            windows_alt_as_cmd: false,
            confirm_before_close_tab: true,
            restore_session_on_startup: true,
            reload_after_supervise_tabs: false,
            space_confirms_dialogs: false,
            locale: default_locale(),
            auto_check_updates: true,
            panel_position: PanelPosition::default(),
            monitor: MonitorConfig::default(),
            notification: NotificationConfig::default(),
            open_api: OpenApiConfig::default(),
            auth_token: String::new(),
            ip_whitelist: default_ip_whitelist(),
            keybindings: std::collections::HashMap::new(),
            log: LogConfig::default(),
            ssh_profiles: vec![],
            active_workspace_id: None,
            auth: AuthConfig::default(),
            preview: PreviewConfig::default(),
            custom_themes: vec![],
            hidden_builtins: vec![],
            plugin_prefs: PluginPrefsConfig::default(),
            shell: default_shell_kind(),
            shell_path: None,
            wsl_distro: None,
        }
    }
}

pub type SettingsState = Arc<RwLock<Settings>>;
