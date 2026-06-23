use axum::{
    body::Body,
    extract::State,
    http::{header, Response, StatusCode},
    response::IntoResponse,
    Json,
};
use axum_extra::extract::Multipart;
use serde::{Deserialize, Serialize};
use std::{
    path::PathBuf,
    sync::Arc,
};
use tokio::sync::RwLock;
use tracing::{error, info};

use crate::session::SessionManager;

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct Settings {
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
    pub keyboard_sound: bool,
    #[serde(default)]
    pub show_virtual_keyboard: bool,
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
}

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct KeyBinding {
    pub key: String,
    #[serde(default)]
    pub shift: bool,
}

#[derive(Serialize, Deserialize, Clone, Debug, Default)]
pub struct OpenApiConfig {
    #[serde(default)]
    pub enabled: bool,
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

fn default_debounce_ms() -> u32 { 300 }

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

fn default_threshold_seconds() -> u32 { 10 }

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

fn default_info_sound() -> SoundConfig { SoundConfig { source: "builtin".into(), value: "ding".into(), volume: 0.7 } }
fn default_success_sound() -> SoundConfig { SoundConfig { source: "builtin".into(), value: "chime-up".into(), volume: 0.7 } }
fn default_warning_sound() -> SoundConfig { SoundConfig { source: "builtin".into(), value: "double-beep".into(), volume: 0.8 } }
fn default_error_sound() -> SoundConfig { SoundConfig { source: "builtin".into(), value: "error-buzz".into(), volume: 0.8 } }
fn default_urgent_sound() -> SoundConfig { SoundConfig { source: "builtin".into(), value: "alarm".into(), volume: 1.0 } }

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct SoundConfig {
    #[serde(default = "default_source")]
    pub source: String,
    #[serde(default)]
    pub value: String,
    #[serde(default = "default_volume")]
    pub volume: f32,
}

fn default_source() -> String { "builtin".into() }
fn default_volume() -> f32 { 0.7 }

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
    vec!["127.0.0.1".into(), "::1".into()]
}

fn default_locale() -> String {
    "zh".into()
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

fn default_preset() -> String { "dark".into() }

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
}

fn default_font_size() -> u8 { 14 }
fn default_line_height() -> f32 { 1.2 }
fn default_cursor_style() -> String { "block".into() }
fn default_true() -> bool { true }
fn default_scrollback() -> u32 { 10000 }

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
        }
    }
}

fn default_mode() -> String { "solid".into() }
fn default_opacity() -> f32 { 1.0 }

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
    pub label: String,
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
            theme: ThemeConfig::default(),
            background: BackgroundConfig::default(),
            text: TextConfig::default(),
            bookmarks: vec![],
            workspace_bookmarks: vec![],
            web_bookmarks: vec![],
            recent_files: vec![],
            recent_urls: vec![],
            action_keyboard: None,
            keyboard_sound: false,
            show_virtual_keyboard: false,
            confirm_before_close_tab: true,
            locale: default_locale(),
            panel_position: PanelPosition::default(),
            monitor: MonitorConfig::default(),
            notification: NotificationConfig::default(),
            open_api: OpenApiConfig::default(),
            auth_token: String::new(),
            ip_whitelist: default_ip_whitelist(),
            keybindings: std::collections::HashMap::new(),
        }
    }
}

fn config_dir() -> PathBuf {
    dirs::config_dir()
        .unwrap_or_else(|| PathBuf::from("."))
        .join("dinotty")
}

fn settings_path() -> PathBuf {
    config_dir().join("settings.json")
}

fn token_path() -> PathBuf {
    config_dir().join("token")
}

pub fn load_token() -> Option<String> {
    std::fs::read_to_string(token_path()).ok().map(|s| s.trim().to_string()).filter(|s| !s.is_empty())
}

pub fn save_token(token: &str) -> Result<(), String> {
    let dir = config_dir();
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    std::fs::write(token_path(), token).map_err(|e| e.to_string())
}

fn bg_image_path() -> PathBuf {
    config_dir().join("bg.webp")
}

pub fn load_settings() -> Settings {
    let path = settings_path();
    if path.exists() {
        match std::fs::read_to_string(&path) {
            Ok(data) => match serde_json::from_str(&data) {
                Ok(s) => return s,
                Err(e) => error!("parse settings: {}", e),
            },
            Err(e) => error!("read settings: {}", e),
        }
    }
    Settings::default()
}

fn save_settings(settings: &Settings) -> Result<(), String> {
    let dir = config_dir();
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    let json = serde_json::to_string_pretty(settings).map_err(|e| e.to_string())?;
    std::fs::write(settings_path(), json).map_err(|e| e.to_string())?;
    Ok(())
}

pub fn save_settings_sync(settings: &Settings) -> Result<(), String> {
    save_settings(settings)
}

pub type SettingsState = Arc<RwLock<Settings>>;

pub fn create_settings_state() -> SettingsState {
    Arc::new(RwLock::new(load_settings()))
}

pub async fn get_settings(
    State(state): State<(Arc<SessionManager>, SettingsState)>,
) -> impl IntoResponse {
    let settings = state.1.read().await;
    Json(settings.clone())
}

pub async fn put_settings(
    State(state): State<(Arc<SessionManager>, SettingsState)>,
    Json(new_settings): Json<Settings>,
) -> impl IntoResponse {
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
            let _ = save_settings(&settings);

            info!("Background image uploaded");
            return StatusCode::OK;
        }
    }
    StatusCode::BAD_REQUEST
}

pub async fn get_background() -> impl IntoResponse {
    let path = bg_image_path();
    if !path.exists() {
        return Response::builder()
            .status(StatusCode::NOT_FOUND)
            .body(Body::from("no background"))
            .unwrap();
    }
    match std::fs::read(&path) {
        Ok(data) => {
            Response::builder()
                .header(header::CONTENT_TYPE, "image/webp")
                .header(header::CACHE_CONTROL, "no-cache")
                .body(Body::from(data))
                .unwrap()
        }
        Err(_) => {
            Response::builder()
                .status(StatusCode::INTERNAL_SERVER_ERROR)
                .body(Body::from("read error"))
                .unwrap()
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn old_config_missing_confirm_before_close_tab_defaults_to_true() {
        // Simulate an old config file that predates the new field.
        // The deserialized Settings should still set confirm_before_close_tab = true
        // for backward compatibility.
        let old_config = r#"{}"#;
        let settings: Settings = serde_json::from_str(old_config)
            .expect("old config without confirm_before_close_tab should still parse");
        assert!(
            settings.confirm_before_close_tab,
            "missing field should default to true for backward compatibility"
        );
    }
}
