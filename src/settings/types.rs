use serde::{ser::SerializeMap, Deserialize, Serialize};
use std::sync::Arc;
use tokio::sync::RwLock;
use zeroize::Zeroize;

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
    #[serde(default)]
    pub reload_after_supervise_tabs: bool,
    #[serde(default)]
    pub space_confirms_dialogs: bool,
    #[serde(default = "default_locale")]
    pub locale: String,
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
}

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

#[derive(Serialize, Deserialize, Clone, Debug, Default)]
pub struct PreviewConfig {
    #[serde(default = "default_preview_allow_external")]
    pub allow_external: bool,
}

pub(crate) fn default_preview_allow_external() -> bool {
    true
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
pub struct NotificationConfig {
    #[serde(default = "default_true")]
    pub enabled: bool,
    #[serde(default)]
    pub bell: BellNotificationConfig,
    #[serde(default = "default_true")]
    pub osc_notify: bool,
    #[serde(default)]
    pub idle_reminder: bool,
    #[serde(default)]
    pub command_complete: CommandCompleteConfig,
    #[serde(default)]
    pub keyword_match: Vec<KeywordRule>,
    #[serde(default)]
    pub channels: NotificationChannels,
    #[serde(default)]
    pub sounds: NotificationSounds,
    #[serde(default)]
    pub hooks: Vec<NotificationHook>,
}

impl Default for NotificationConfig {
    fn default() -> Self {
        Self {
            enabled: true,
            bell: BellNotificationConfig::default(),
            osc_notify: true,
            idle_reminder: false,
            command_complete: CommandCompleteConfig::default(),
            keyword_match: vec![],
            channels: NotificationChannels::default(),
            sounds: NotificationSounds::default(),
            hooks: vec![],
        }
    }
}

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct BellNotificationConfig {
    #[serde(default = "default_true")]
    pub enabled: bool,
    #[serde(default = "default_debounce_ms")]
    pub debounce_ms: u32,
}

pub(crate) fn default_debounce_ms() -> u32 {
    300
}

impl Default for BellNotificationConfig {
    fn default() -> Self {
        Self { enabled: true, debounce_ms: 300 }
    }
}

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct CommandCompleteConfig {
    #[serde(default)]
    pub enabled: bool,
    #[serde(default = "default_threshold_seconds")]
    pub threshold_seconds: u32,
}

pub(crate) fn default_threshold_seconds() -> u32 {
    10
}

impl Default for CommandCompleteConfig {
    fn default() -> Self {
        Self { enabled: false, threshold_seconds: 10 }
    }
}

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct KeywordRule {
    pub pattern: String,
    pub notification_type: NotificationType,
    #[serde(default)]
    pub case_sensitive: bool,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
#[allow(clippy::struct_excessive_bools)]
pub struct NotificationChannels {
    #[serde(default = "default_true")]
    pub sound: bool,
    #[serde(default = "default_true")]
    pub vibration: bool,
    #[serde(default = "default_true")]
    pub panel: bool,
    #[serde(default = "default_true")]
    pub tab_indicator: bool,
}

impl Default for NotificationChannels {
    fn default() -> Self {
        Self { sound: true, vibration: true, panel: true, tab_indicator: true }
    }
}

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct NotificationSounds {
    #[serde(default = "default_info_sound")]
    pub info: SoundConfig,
    #[serde(default = "default_success_sound")]
    pub success: SoundConfig,
    #[serde(default = "default_warning_sound")]
    pub warning: SoundConfig,
    #[serde(default = "default_error_sound")]
    pub error: SoundConfig,
    #[serde(default = "default_urgent_sound")]
    pub urgent: SoundConfig,
}

impl Default for NotificationSounds {
    fn default() -> Self {
        Self {
            info: default_info_sound(),
            success: default_success_sound(),
            warning: default_warning_sound(),
            error: default_error_sound(),
            urgent: default_urgent_sound(),
        }
    }
}

pub(crate) fn default_info_sound() -> SoundConfig {
    SoundConfig { source: "builtin".into(), value: "ding".into(), volume: 0.7 }
}
pub(crate) fn default_success_sound() -> SoundConfig {
    SoundConfig { source: "builtin".into(), value: "chime-up".into(), volume: 0.7 }
}
pub(crate) fn default_warning_sound() -> SoundConfig {
    SoundConfig { source: "builtin".into(), value: "double-beep".into(), volume: 0.8 }
}
pub(crate) fn default_error_sound() -> SoundConfig {
    SoundConfig { source: "builtin".into(), value: "error-buzz".into(), volume: 0.8 }
}
pub(crate) fn default_urgent_sound() -> SoundConfig {
    SoundConfig { source: "builtin".into(), value: "alarm".into(), volume: 1.0 }
}

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct SoundConfig {
    #[serde(default = "default_source")]
    pub source: String,
    #[serde(default)]
    pub value: String,
    #[serde(default = "default_volume")]
    pub volume: f32,
}

pub(crate) fn default_source() -> String {
    "builtin".into()
}
pub(crate) fn default_volume() -> f32 {
    0.7
}

#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(rename_all = "snake_case")]
pub enum NotificationType {
    Info,
    Success,
    Warning,
    Error,
    Urgent,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct NotificationHook {
    #[serde(default = "default_true")]
    pub enabled: bool,
    pub notification_type: Option<NotificationType>,
    pub command: String,
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

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct ThemeConfig {
    #[serde(default = "default_preset")]
    pub preset: String,
    #[serde(default)]
    pub custom: Option<CustomColors>,
}

pub(crate) fn default_preset() -> String {
    "dark".into()
}

impl Default for ThemeConfig {
    fn default() -> Self {
        Self { preset: default_preset(), custom: None }
    }
}

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct CustomColors {
    pub foreground: Option<String>,
    pub background: Option<String>,
    pub cursor: Option<String>,
    pub ansi: Option<Vec<Option<String>>>,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct ThemeColors {
    pub foreground: String,
    pub background: String,
    pub cursor: String,
    pub ansi: [String; 16],
}

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct SavedTheme {
    pub uuid: String,
    pub name: String,
    pub colors: ThemeColors,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct BackgroundConfig {
    #[serde(default = "default_mode")]
    pub mode: String,
    #[serde(default)]
    pub color: Option<String>,
    #[serde(default = "default_opacity")]
    pub opacity: f32,
    #[serde(default)]
    pub has_image: bool,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct TextConfig {
    #[serde(default = "default_font_size")]
    pub font_size: u8,
    #[serde(default)]
    pub font_family: String,
    #[serde(default = "default_line_height")]
    pub line_height: f32,
    #[serde(default)]
    pub letter_spacing: f32,
    #[serde(default = "default_cursor_style")]
    pub cursor_style: String,
    #[serde(default = "default_true")]
    pub cursor_blink: bool,
    #[serde(default = "default_scrollback")]
    pub scrollback: u32,
    #[serde(default = "default_scroll_sensitivity")]
    pub scroll_sensitivity: f32,
    #[serde(default = "default_scroll_acceleration")]
    pub scroll_acceleration: f32,
    #[serde(default = "default_scrollbar_width")]
    pub scrollbar_width: u8,
    #[serde(default)]
    pub custom_fonts: Option<Vec<String>>,
}

pub(crate) fn default_font_size() -> u8 {
    14
}
pub(crate) fn default_line_height() -> f32 {
    1.2
}
pub(crate) fn default_cursor_style() -> String {
    "block".into()
}
pub(crate) fn default_true() -> bool {
    true
}
pub(crate) fn default_scrollback() -> u32 {
    10000
}
pub(crate) fn default_scroll_sensitivity() -> f32 {
    1.0
}
pub(crate) fn default_scroll_acceleration() -> f32 {
    0.0
}
pub(crate) fn default_scrollbar_width() -> u8 {
    8
}

impl Default for TextConfig {
    fn default() -> Self {
        Self {
            font_size: default_font_size(),
            font_family: String::new(),
            line_height: default_line_height(),
            letter_spacing: 0.0,
            cursor_style: default_cursor_style(),
            cursor_blink: true,
            scrollback: default_scrollback(),
            scroll_sensitivity: default_scroll_sensitivity(),
            scroll_acceleration: default_scroll_acceleration(),
            scrollbar_width: default_scrollbar_width(),
            custom_fonts: None,
        }
    }
}

pub(crate) fn default_mode() -> String {
    "solid".into()
}
pub(crate) fn default_opacity() -> f32 {
    1.0
}

impl Default for BackgroundConfig {
    fn default() -> Self {
        Self { mode: default_mode(), color: None, opacity: 1.0, has_image: false }
    }
}

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct CommandBookmark {
    pub id: String,
    pub name: String,
    pub command: String,
    #[serde(default)]
    pub group: Option<String>,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct WorkspaceBookmark {
    pub id: String,
    pub name: String,
    pub path: String,
    pub is_dir: bool,
    #[serde(default)]
    pub group: Option<String>,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct WebBookmark {
    pub id: String,
    pub name: String,
    pub url: String,
    #[serde(default)]
    pub group: Option<String>,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct RecentEntry {
    pub path_or_url: String,
    pub name: String,
    pub visited_at: u64,
}

#[derive(Deserialize, Clone, Debug, PartialEq)]
pub struct ActionKey {
    #[serde(default)]
    pub label: String,
    #[serde(default)]
    pub kind: Option<String>,
    #[serde(default)]
    pub action: Option<String>,
    #[serde(default)]
    pub display: Option<String>,
    #[serde(default)]
    pub send: String,
    #[serde(default)]
    pub style: Option<String>,
    #[serde(default)]
    pub shape: Option<String>,
    #[serde(default)]
    pub repeat: bool,
    #[serde(default)]
    pub special: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub auto_enter: Option<bool>,
    #[serde(default)]
    pub grow: Option<f64>,
}

impl Serialize for ActionKey {
    fn serialize<S>(&self, serializer: S) -> Result<S::Ok, S::Error>
    where
        S: serde::Serializer,
    {
        let is_valid_action = self.kind.as_deref() == Some("action")
            && self.action.as_deref().is_some_and(|action| !action.trim().is_empty());
        let is_paste_action = is_valid_action && self.action.as_deref() == Some("pasteTerminal");
        let mut map = serializer.serialize_map(None)?;
        map.serialize_entry("label", &self.label)?;
        if let Some(kind) = &self.kind {
            map.serialize_entry("kind", kind)?;
        }
        if let Some(action) = &self.action {
            map.serialize_entry("action", action)?;
        }
        if let Some(display) = &self.display {
            map.serialize_entry("display", display)?;
        }
        if let Some(style) = &self.style {
            map.serialize_entry("style", style)?;
        }
        if let Some(shape) = &self.shape {
            map.serialize_entry("shape", shape)?;
        }
        if let Some(grow) = &self.grow {
            map.serialize_entry("grow", grow)?;
        }
        if !is_valid_action {
            map.serialize_entry("send", &self.send)?;
            map.serialize_entry("repeat", &self.repeat)?;
            map.serialize_entry("special", &self.special)?;
        }
        if (!is_valid_action || is_paste_action) && self.auto_enter.is_some() {
            map.serialize_entry("auto_enter", &self.auto_enter)?;
        }
        map.end()
    }
}

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq)]
pub struct ActionBottomCluster {
    #[serde(default)]
    pub rows: Vec<Vec<ActionKey>>,
    #[serde(default)]
    pub enter: Option<ActionKey>,
    #[serde(default)]
    pub enter_width: Option<f64>,
}

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq)]
pub struct ActionKeyboardConfig {
    pub rows: Vec<Vec<ActionKey>>,
    #[serde(default)]
    pub bottom: Option<ActionBottomCluster>,
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
            keyboard_guard_mode: KeyboardGuardMode::default(),
            keyboard_keep_on_scroll: false,
            show_workspace_badge_on_tab: None,
            workspace_badge_mode: None,
            windows_alt_as_cmd: false,
            confirm_before_close_tab: true,
            reload_after_supervise_tabs: false,
            space_confirms_dialogs: false,
            locale: default_locale(),
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
        }
    }
}

pub type SettingsState = Arc<RwLock<Settings>>;

// ─── SSH 配置类型 ───

/// 敏感字符串，Drop 时自动清零内存
#[derive(Clone, Debug, Zeroize)]
#[zeroize(drop)]
#[derive(Default)]
pub struct SensitiveString(String);

impl SensitiveString {
    #[must_use]
    pub fn new(s: String) -> Self {
        Self(s)
    }
    #[must_use]
    pub fn expose(&self) -> &str {
        &self.0
    }
    #[must_use]
    pub fn is_empty(&self) -> bool {
        self.0.is_empty()
    }
}

impl Serialize for SensitiveString {
    fn serialize<S: serde::Serializer>(&self, serializer: S) -> Result<S::Ok, S::Error> {
        serializer.serialize_str(&self.0)
    }
}

impl<'de> Deserialize<'de> for SensitiveString {
    fn deserialize<D: serde::Deserializer<'de>>(deserializer: D) -> Result<Self, D::Error> {
        String::deserialize(deserializer).map(SensitiveString::new)
    }
}

#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum SshAuthMethod {
    Password { password: SensitiveString },
    KeyFile { key_path: String, passphrase: Option<SensitiveString> },
    KeyInline { private_key: SensitiveString, passphrase: Option<SensitiveString> },
}

impl Default for SshAuthMethod {
    fn default() -> Self {
        Self::Password { password: SensitiveString::default() }
    }
}

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct SshProfile {
    pub id: String,
    pub name: String,
    pub host: String,
    #[serde(default = "default_ssh_port")]
    pub port: u16,
    #[serde(default = "default_ssh_username")]
    pub username: String,
    pub auth_method: SshAuthMethod,
    #[serde(default)]
    pub group: Option<String>,
    #[serde(default)]
    pub default_command: Option<String>,
}

pub(crate) fn default_ssh_port() -> u16 {
    22
}

pub(crate) fn default_ssh_username() -> String {
    "root".into()
}
