#![allow(clippy::unwrap_used, clippy::expect_used)]
use axum::{
    body::Body,
    extract::State,
    http::{header, Response, StatusCode},
    response::IntoResponse,
    Json,
};
use axum_extra::extract::Multipart;
use serde::{Deserialize, Serialize};
use std::{path::PathBuf, sync::Arc};
use tokio::sync::RwLock;
use tracing::{error, info};
use zeroize::Zeroize;

use crate::session::SessionManager;

pub const CURRENT_SETTINGS_VERSION: u32 = 3;
const LEGACY_UPLOAD_DIR: &str = "~/.dinotty/uploads";

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
    #[serde(default = "default_upload_dir")]
    pub upload_dir: String,
    #[serde(default = "default_upload_cap_mb")]
    pub upload_cap_mb: u64,
    #[serde(default = "default_upload_cap_count")]
    pub upload_cap_count: u32,
    #[serde(default)]
    pub upload_file_cap_mb: u64,
    #[serde(default)]
    pub keyboard_sound: bool,
    #[serde(default)]
    pub show_virtual_keyboard: bool,
    #[serde(default, rename = "windowsAltAsCmd")]
    pub windows_alt_as_cmd: bool,
    #[serde(default = "default_true")]
    pub confirm_before_close_tab: bool,
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

fn default_lockout_strategy() -> String {
    "ip".into()
}

fn default_session_ttl_days() -> u64 {
    7
}

fn default_lockout_max_failures() -> u32 {
    5
}

fn default_lockout_secs() -> u64 {
    60
}

fn default_global_lockout_max_failures() -> u32 {
    50
}

fn default_global_lockout_secs() -> u64 {
    300
}

#[derive(Serialize, Deserialize, Clone, Debug, Default)]
pub struct PreviewConfig {
    #[serde(default)]
    pub allow_external: bool,
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
fn is_false(b: &bool) -> bool {
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

fn default_log_max_size() -> u64 {
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

fn default_debounce_ms() -> u32 {
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

fn default_threshold_seconds() -> u32 {
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

fn default_info_sound() -> SoundConfig {
    SoundConfig { source: "builtin".into(), value: "ding".into(), volume: 0.7 }
}
fn default_success_sound() -> SoundConfig {
    SoundConfig { source: "builtin".into(), value: "chime-up".into(), volume: 0.7 }
}
fn default_warning_sound() -> SoundConfig {
    SoundConfig { source: "builtin".into(), value: "double-beep".into(), volume: 0.8 }
}
fn default_error_sound() -> SoundConfig {
    SoundConfig { source: "builtin".into(), value: "error-buzz".into(), volume: 0.8 }
}
fn default_urgent_sound() -> SoundConfig {
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

fn default_source() -> String {
    "builtin".into()
}
fn default_volume() -> f32 {
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
}

impl Default for MonitorConfig {
    fn default() -> Self {
        Self { enabled: true, cpu: true, memory: true, disk: true, network: true, gpu: true }
    }
}

fn default_ip_whitelist() -> Vec<String> {
    // Server mode: no loopback bypass by default - local access must
    // authenticate, preventing SSH port-forwarding bypass. Desktop mode keeps
    // loopback bypass for Tauri zero-config.
    if cfg!(feature = "server") {
        vec![]
    } else {
        vec!["127.0.0.1".into(), "::1".into()]
    }
}

fn default_locale() -> String {
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

fn default_upload_cap_mb() -> u64 {
    200
}

fn default_upload_cap_count() -> u32 {
    100
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

fn default_preset() -> String {
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
}

fn default_font_size() -> u8 {
    14
}
fn default_line_height() -> f32 {
    1.2
}
fn default_cursor_style() -> String {
    "block".into()
}
fn default_true() -> bool {
    true
}
fn default_scrollback() -> u32 {
    10000
}
fn default_scroll_sensitivity() -> f32 {
    1.0
}
fn default_scroll_acceleration() -> f32 {
    0.0
}
fn default_scrollbar_width() -> u8 {
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
        }
    }
}

fn clamp_text_config(t: &mut TextConfig) {
    t.scroll_sensitivity = if t.scroll_sensitivity.is_finite() {
        t.scroll_sensitivity.clamp(0.1, 2.0)
    } else {
        default_scroll_sensitivity()
    };
    t.scroll_acceleration = if t.scroll_acceleration.is_finite() {
        t.scroll_acceleration.clamp(0.0, 5.0)
    } else {
        default_scroll_acceleration()
    };
    t.scrollbar_width = t.scrollbar_width.clamp(4, 16);
}

fn default_mode() -> String {
    "solid".into()
}
fn default_opacity() -> f32 {
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

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct ActionKey {
    #[serde(default)]
    pub label: String,
    #[serde(default)]
    pub send: String,
    #[serde(default)]
    pub style: Option<String>,
    #[serde(default)]
    pub repeat: bool,
    #[serde(default)]
    pub special: Option<String>,
    #[serde(default)]
    pub auto_enter: bool,
    #[serde(default)]
    pub grow: Option<f64>,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct ActionKeyboardConfig {
    pub rows: Vec<Vec<ActionKey>>,
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
            upload_dir: default_upload_dir(),
            upload_cap_mb: default_upload_cap_mb(),
            upload_cap_count: default_upload_cap_count(),
            upload_file_cap_mb: 0,
            keyboard_sound: false,
            show_virtual_keyboard: false,
            windows_alt_as_cmd: false,
            confirm_before_close_tab: true,
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
        }
    }
}

#[must_use]
pub fn config_dir() -> PathBuf {
    dirs::config_dir().unwrap_or_else(|| PathBuf::from(".")).join("dinotty")
}

fn settings_path() -> PathBuf {
    config_dir().join("settings.json")
}

fn token_path() -> PathBuf {
    config_dir().join("token")
}

#[must_use]
pub fn load_token() -> Option<String> {
    std::fs::read_to_string(token_path())
        .ok()
        .map(|s| s.trim().to_string())
        .filter(|s| !s.is_empty())
}

/// # Errors
/// Returns `Err` if the config directory cannot be created or the file cannot be written.
pub fn save_token(token: &str) -> Result<(), String> {
    let dir = config_dir();
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    let path = token_path();
    std::fs::write(&path, token).map_err(|e| e.to_string())?;
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        let _ = std::fs::set_permissions(&path, std::fs::Permissions::from_mode(0o600));
    }
    Ok(())
}

fn bg_image_path() -> PathBuf {
    config_dir().join("bg.webp")
}

pub fn load_settings() -> Settings {
    let path = settings_path();
    if path.exists() {
        match std::fs::read_to_string(&path) {
            Ok(data) => match serde_json::from_str::<Settings>(&data) {
                Ok(mut settings) => {
                    let migrated = migrate_settings(&mut settings);
                    clamp_text_config(&mut settings.text);
                    if migrated {
                        if let Err(e) = save_settings(&settings) {
                            error!("migrate settings: {}", e);
                        }
                    }
                    return settings;
                }
                Err(e) => error!("parse settings: {}", e),
            },
            Err(e) => error!("read settings: {}", e),
        }
    }
    Settings::default()
}

fn migrate_settings(settings: &mut Settings) -> bool {
    if settings.settings_version >= CURRENT_SETTINGS_VERSION {
        return false;
    }
    let old_resolved_upload_dir =
        std::env::temp_dir().join("dinotty").to_string_lossy().into_owned();
    if settings.upload_dir.is_empty()
        || settings.upload_dir == LEGACY_UPLOAD_DIR
        || settings.upload_dir == old_resolved_upload_dir
    {
        settings.upload_dir = default_upload_dir();
    }
    // v3: auth + preview sections added with serde defaults - no explicit migration needed.
    settings.settings_version = CURRENT_SETTINGS_VERSION;
    true
}

fn save_settings(settings: &Settings) -> Result<(), String> {
    let dir = config_dir();
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    let json = serde_json::to_string_pretty(settings).map_err(|e| e.to_string())?;
    std::fs::write(settings_path(), json).map_err(|e| e.to_string())?;
    Ok(())
}

/// # Errors
/// Returns `Err` if the config directory cannot be created or the file cannot be written.
pub fn save_settings_sync(settings: &Settings) -> Result<(), String> {
    save_settings(settings)
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

fn default_ssh_port() -> u16 {
    22
}

fn default_ssh_username() -> String {
    "root".into()
}

#[must_use]
pub fn create_settings_state() -> SettingsState {
    Arc::new(RwLock::new(load_settings()))
}

pub async fn get_settings(
    State(state): State<(Arc<SessionManager>, SettingsState)>,
) -> impl IntoResponse {
    let mut settings = state.1.read().await.clone();
    if settings.log.path.is_empty() {
        settings.log.path = log_file_path().to_string_lossy().to_string();
    }
    Json(settings)
}

pub async fn put_settings(
    State(state): State<(Arc<SessionManager>, SettingsState)>,
    Json(mut new_settings): Json<Settings>,
) -> impl IntoResponse {
    new_settings.settings_version = CURRENT_SETTINGS_VERSION;
    clamp_text_config(&mut new_settings.text);
    match save_settings(&new_settings) {
        Ok(()) => {
            *state.1.write().await = new_settings;
            StatusCode::OK
        }
        Err(e) => {
            error!("save settings: {}", e);
            StatusCode::INTERNAL_SERVER_ERROR
        }
    }
}

pub async fn upload_background(
    State(state): State<(Arc<SessionManager>, SettingsState)>,
    mut multipart: Multipart,
) -> impl IntoResponse {
    while let Ok(Some(field)) = multipart.next_field().await {
        if field.name() == Some("file") {
            let data = match field.bytes().await {
                Ok(d) => d,
                Err(e) => {
                    error!("read upload: {}", e);
                    return StatusCode::BAD_REQUEST;
                }
            };

            let dir = config_dir();
            let _ = std::fs::create_dir_all(&dir);

            // Try to decode and re-encode as WebP for compression
            match image::load_from_memory(&data) {
                Ok(img) => {
                    let resized = if img.width() > 2048 || img.height() > 2048 {
                        img.resize(2048, 2048, image::imageops::FilterType::Lanczos3)
                    } else {
                        img
                    };
                    if let Err(e) = resized.save(bg_image_path()) {
                        error!("save bg image: {}", e);
                        return StatusCode::INTERNAL_SERVER_ERROR;
                    }
                }
                Err(_) => {
                    // Can't decode as image — save raw
                    if let Err(e) = std::fs::write(bg_image_path(), &data) {
                        error!("save bg raw: {}", e);
                        return StatusCode::INTERNAL_SERVER_ERROR;
                    }
                }
            }

            // Update settings
            let mut settings = state.1.write().await;
            settings.background.has_image = true;
            settings.settings_version = CURRENT_SETTINGS_VERSION;
            let _ = save_settings(&settings);

            info!("Background image uploaded");
            return StatusCode::OK;
        }
    }
    StatusCode::BAD_REQUEST
}

/// # Panics
/// Panics if the response builder fails (which should not happen with valid status codes and bodies).
#[allow(clippy::unused_async)]
pub async fn get_background() -> impl IntoResponse {
    let path = bg_image_path();
    if !path.exists() {
        return Response::builder()
            .status(StatusCode::NOT_FOUND)
            .body(Body::from("no background"))
            .unwrap();
    }
    match std::fs::read(&path) {
        Ok(data) => Response::builder()
            .header(header::CONTENT_TYPE, "image/webp")
            .header(header::CACHE_CONTROL, "no-cache")
            .body(Body::from(data))
            .unwrap(),
        Err(_) => Response::builder()
            .status(StatusCode::INTERNAL_SERVER_ERROR)
            .body(Body::from("read error"))
            .unwrap(),
    }
}

#[must_use]
pub fn log_dir() -> PathBuf {
    config_dir().join("logs")
}

#[must_use]
pub fn log_file_path() -> PathBuf {
    log_dir().join("dinotty.log")
}

#[allow(clippy::unused_async, clippy::missing_panics_doc)]
pub async fn get_log(
    State(state): State<(Arc<SessionManager>, SettingsState)>,
) -> impl IntoResponse {
    let settings = state.1.read().await;
    if !settings.log.enabled {
        return Response::builder()
            .status(StatusCode::OK)
            .header(header::CONTENT_TYPE, "text/plain; charset=utf-8")
            .body(Body::from("日志保存未启用"))
            .unwrap();
    }

    let path = if settings.log.path.is_empty() {
        log_file_path()
    } else {
        PathBuf::from(&settings.log.path)
    };

    if !path.exists() {
        return Response::builder()
            .status(StatusCode::OK)
            .header(header::CONTENT_TYPE, "text/plain; charset=utf-8")
            .body(Body::from("暂无日志"))
            .unwrap();
    }

    // Read last 1MB of log to avoid overwhelming the browser
    let read_size: usize = 1024 * 1024; // 1MB

    match std::fs::read(&path) {
        Ok(data) => {
            let content = if data.len() > read_size {
                let start = data.len() - read_size;
                String::from_utf8_lossy(&data[start..]).into_owned()
            } else {
                String::from_utf8_lossy(&data).into_owned()
            };
            Response::builder()
                .status(StatusCode::OK)
                .header(header::CONTENT_TYPE, "text/plain; charset=utf-8")
                .body(Body::from(content))
                .unwrap()
        }
        Err(_) => Response::builder()
            .status(StatusCode::INTERNAL_SERVER_ERROR)
            .body(Body::from("读取日志失败"))
            .unwrap(),
    }
}

#[cfg(test)]
mod tests;
