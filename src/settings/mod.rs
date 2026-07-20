#![allow(clippy::unwrap_used, clippy::expect_used)]
use axum::{
    body::Body,
    extract::State,
    http::{header, Response, StatusCode},
    response::IntoResponse,
    Json,
};
use axum_extra::extract::Multipart;
use serde::{ser::SerializeMap, Deserialize, Serialize};
use std::{path::PathBuf, sync::Arc};
use tokio::sync::RwLock;
use tracing::{error, info};
use tracing_subscriber::{layer::SubscriberExt, util::SubscriberInitExt};
use zeroize::Zeroize;

use crate::session::SessionManager;

pub const CURRENT_SETTINGS_VERSION: u32 = 6;
const LEGACY_UPLOAD_DIR: &str = "~/.dinotty/uploads";

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
    #[serde(default)]
    pub show_virtual_keyboard: bool,
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
    #[serde(default = "default_preview_allow_external")]
    pub allow_external: bool,
}

fn default_preview_allow_external() -> bool {
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
            custom_fonts: None,
        }
    }
}

const FONT_ANCHORS: [&str; 5] =
    ["Menlo", "Consolas", "Courier New", "DejaVu Sans Mono", "monospace"];

/// Trim ASCII/Unicode whitespace AND U+FEFF (BOM/ZWNBSP), matching JS `String.trim()` which
/// strips U+FEFF as ECMAScript `WhiteSpace`. Rust `str::trim()` does not remove U+FEFF.
fn trim_font(s: &str) -> &str {
    s.trim_matches(|c: char| c.is_whitespace() || c == '\u{FEFF}')
}

/// Extract the primary family from a plain name OR a CSS stack: first comma segment, strip one
/// matched outer quote pair (ASCII ' or "), trim. Mirrors the TS primaryFamily.
fn primary_family(value: &str) -> String {
    let first = trim_font(value.split(',').next().unwrap_or(""));
    let mut chars = first.chars();
    if let (Some(f), Some(l)) = (chars.next(), first.chars().last()) {
        if first.chars().count() >= 2 && (f == '"' || f == '\'') && f == l {
            // Use char-based indices to avoid panicking on multi-byte UTF-8 boundaries.
            let inner: String = first.chars().skip(1).take(first.chars().count() - 2).collect();
            return trim_font(&inner).to_string();
        }
    }
    first.to_string()
}

fn clamp_custom_fonts(v: &mut Vec<String>) -> bool {
    let anchor_identities: Vec<String> =
        FONT_ANCHORS.iter().map(|anchor| anchor.to_lowercase()).collect();
    let mut seen = Vec::new();
    let mut sanitized = Vec::new();

    for entry in v.iter() {
        let primary = primary_family(entry);
        let trimmed = trim_font(&primary);
        if trimmed.is_empty()
            || trimmed.chars().count() > 100
            || trimmed.chars().any(|c| {
                c == '"' || c == '\\' || c.is_control() || matches!(c, '<' | '>' | ';' | '{' | '}')
            })
        {
            continue;
        }

        let identity = trimmed.to_lowercase();
        if anchor_identities.contains(&identity) || seen.contains(&identity) {
            continue;
        }

        seen.push(identity);
        sanitized.push(trimmed.to_string());
        if sanitized.len() == 20 {
            break;
        }
    }

    let changed = sanitized.len() != v.len() || sanitized.iter().zip(v.iter()).any(|(a, b)| a != b);
    *v = sanitized;
    changed
}

const BASE_THEME_NAMES: [&str; 3] = ["dark", "light", "dracula"];
const THEME_CUSTOM_CAP: usize = 15;

/// Normalize a single hex color IN PLACE to lowercase `#rrggbb`.
/// Accepts `#rgb` (expands) and `#rrggbb` (case-normalizes). Unrepairable -> replace with `fallback`
/// (never errors, never deletes the owning theme). Returns true if the value changed.
fn normalize_hex_color(c: &mut String, fallback: &str) -> bool {
    let orig = c.clone();
    let s = c.trim();
    let normalized = if let Some(hex) = s.strip_prefix('#') {
        let hex_lower = hex.to_ascii_lowercase();
        let is_hex = |t: &str| t.chars().all(|ch| ch.is_ascii_hexdigit());
        if hex_lower.len() == 6 && is_hex(&hex_lower) {
            format!("#{hex_lower}")
        } else if hex_lower.len() == 3 && is_hex(&hex_lower) {
            let mut expanded = String::from("#");
            for ch in hex_lower.chars() {
                expanded.push(ch);
                expanded.push(ch);
            }
            expanded
        } else {
            fallback.to_string()
        }
    } else {
        fallback.to_string()
    };
    *c = normalized;
    *c != orig
}

fn normalize_theme_colors(colors: &mut ThemeColors) -> bool {
    let mut changed = false;
    changed |= normalize_hex_color(&mut colors.foreground, "#ffffff");
    changed |= normalize_hex_color(&mut colors.background, "#000000");
    changed |= normalize_hex_color(&mut colors.cursor, "#ffffff");
    for a in &mut colors.ansi {
        changed |= normalize_hex_color(a, "#000000");
    }
    changed
}

/// PUT-only theme-library clamp.
/// - normalize every theme's colors
/// - drop duplicate uuids keeping first (corruption cleanup)
/// - remove the 3 base names from `hidden_builtins` + dedup `hidden_builtins`
/// - truncate `custom_themes` to `THEME_CUSTOM_CAP` (frontend already blocks over-cap adds; this is the
///   backend-owned independent hard bound)
///
/// Returns true if anything changed.
fn clamp_theme_library(
    custom_themes: &mut Vec<SavedTheme>,
    hidden_builtins: &mut Vec<String>,
) -> bool {
    let mut changed = false;

    let mut seen_uuids: Vec<String> = Vec::new();
    let mut kept: Vec<SavedTheme> = Vec::new();
    for mut t in custom_themes.drain(..) {
        if seen_uuids.contains(&t.uuid) {
            changed = true;
            continue;
        }
        seen_uuids.push(t.uuid.clone());
        if normalize_theme_colors(&mut t.colors) {
            changed = true;
        }
        kept.push(t);
    }
    *custom_themes = kept;

    let mut seen_hidden: Vec<String> = Vec::new();
    let mut hidden_kept: Vec<String> = Vec::new();
    for name in hidden_builtins.drain(..) {
        if BASE_THEME_NAMES.contains(&name.as_str()) {
            changed = true;
            continue;
        }
        if seen_hidden.contains(&name) {
            changed = true;
            continue;
        }
        seen_hidden.push(name.clone());
        hidden_kept.push(name);
    }
    *hidden_builtins = hidden_kept;

    if custom_themes.len() > THEME_CUSTOM_CAP {
        custom_themes.truncate(THEME_CUSTOM_CAP);
        changed = true;
    }
    changed
}

fn clamp_theme_on_put(settings: &mut Settings) -> bool {
    clamp_theme_library(&mut settings.custom_themes, &mut settings.hidden_builtins)
}

// Legit CSS font stacks contain only letters/digits/space/comma/quotes.
// Anything with control chars or < > ; { } is a CSS-injection vector -> neutralise.
fn font_family_is_unsafe(s: &str) -> bool {
    s.chars().any(|c| c.is_control() || matches!(c, '<' | '>' | ';' | '{' | '}'))
}

fn clamp_text_config(t: &mut TextConfig) -> bool {
    let old_scroll_sensitivity = t.scroll_sensitivity;
    let old_scroll_acceleration = t.scroll_acceleration;
    let old_scrollbar_width = t.scrollbar_width;

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

    let mut changed = t.scroll_sensitivity.to_bits() != old_scroll_sensitivity.to_bits()
        || t.scroll_acceleration.to_bits() != old_scroll_acceleration.to_bits()
        || t.scrollbar_width != old_scrollbar_width;
    if let Some(v) = t.custom_fonts.as_mut() {
        if clamp_custom_fonts(v) {
            changed = true;
        }
    }
    if font_family_is_unsafe(&t.font_family) {
        t.font_family = "monospace".to_string();
        changed = true;
    }
    changed
}

fn clamp_text_on_load(t: &mut TextConfig) -> bool {
    clamp_text_config(t)
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
    pub repeat: bool,
    #[serde(default)]
    pub special: Option<String>,
    #[serde(default)]
    pub auto_enter: bool,
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
        if let Some(grow) = &self.grow {
            map.serialize_entry("grow", grow)?;
        }
        if !is_valid_action {
            map.serialize_entry("send", &self.send)?;
            map.serialize_entry("repeat", &self.repeat)?;
            map.serialize_entry("special", &self.special)?;
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

fn normalize_action_key(key: &mut ActionKey) {
    if let Some(grow) = key.grow {
        key.grow = grow.is_finite().then(|| grow.clamp(0.5, 12.0));
    }

    if key.kind.as_deref().is_some_and(|kind| kind != "send" && kind != "action") {
        key.kind = Some("send".to_string());
    }

    if !matches!(key.display.as_deref(), Some("icon" | "text")) {
        key.display = None;
    }

    let is_valid_action = key.kind.as_deref() == Some("action")
        && key.action.as_deref().is_some_and(|action| !action.trim().is_empty());
    if is_valid_action {
        key.send.clear();
        key.special = None;
        key.repeat = false;
        key.auto_enter = false;
    }
}

fn default_action_enter(label: String) -> ActionKey {
    ActionKey {
        label,
        kind: Some("send".to_string()),
        action: None,
        display: None,
        send: "\r".to_string(),
        style: None,
        repeat: false,
        special: None,
        auto_enter: false,
        grow: None,
    }
}

impl ActionKeyboardConfig {
    pub fn normalize(&mut self) {
        for row in &mut self.rows {
            for key in row {
                normalize_action_key(key);
            }
        }

        let Some(bottom) = self.bottom.as_mut() else {
            return;
        };
        for row in &mut bottom.rows {
            for key in row {
                normalize_action_key(key);
            }
        }

        if let Some(enter) = bottom.enter.as_mut() {
            normalize_action_key(enter);
        }
        let enter_is_valid = bottom
            .enter
            .as_ref()
            .is_some_and(|enter| enter.kind.as_deref() == Some("send") && enter.send == "\r");
        if !enter_is_valid {
            let label = bottom
                .enter
                .as_ref()
                .map(|enter| enter.label.as_str())
                .filter(|label| !label.trim().is_empty())
                .unwrap_or("↵")
                .to_string();
            bottom.enter = Some(default_action_enter(label));
        }

        if let Some(width) = bottom.enter_width {
            bottom.enter_width = width.is_finite().then(|| width.clamp(0.15, 0.50));
        }
    }
}

fn normalize_action_keyboards(settings: &mut Settings) -> bool {
    let before = (settings.action_keyboard.clone(), settings.action_keyboard_user_default.clone());
    if let Some(config) = settings.action_keyboard.as_mut() {
        config.normalize();
    }
    if let Some(config) = settings.action_keyboard_user_default.as_mut() {
        config.normalize();
    }
    before != (settings.action_keyboard.clone(), settings.action_keyboard_user_default.clone())
}

impl Settings {
    /// Resolve `default_workspace_root`, returning `None` when unset, empty,
    /// whitespace-only, or not a directory.
    pub fn resolved_default_workspace_root(&self) -> Option<std::path::PathBuf> {
        self.default_workspace_root
            .as_deref()
            .map(str::trim)
            .filter(|p| !p.is_empty())
            .map(std::path::PathBuf::from)
            .filter(|p| p.is_dir())
    }
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
            upload_cap_mb: default_upload_cap_mb(),
            upload_cap_count: default_upload_cap_count(),
            upload_file_cap_mb: 0,
            keyboard_sound: false,
            show_virtual_keyboard: false,
            show_workspace_badge_on_tab: None,
            workspace_badge_mode: None,
            windows_alt_as_cmd: false,
            confirm_before_close_tab: true,
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

#[must_use]
pub fn config_dir() -> PathBuf {
    dirs::config_dir()
        .unwrap_or_else(|| PathBuf::from("."))
        .join(format!("dinotty{}", option_env!("DINOTTY_CONFIG_SUFFIX").unwrap_or("")))
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
    let mut settings = if path.exists() {
        match std::fs::read_to_string(&path) {
            Ok(data) => match serde_json::from_str::<Settings>(&data) {
                Ok(mut settings) => {
                    let mut migrated = migrate_settings(&mut settings);
                    if settings.upload_dir.trim().is_empty() {
                        settings.upload_dir = default_upload_dir();
                        migrated = true;
                    }
                    let text_changed = clamp_text_config(&mut settings.text);
                    let action_keyboard_changed = normalize_action_keyboards(&mut settings);
                    if migrated || text_changed || action_keyboard_changed {
                        if let Err(e) = save_settings(&settings) {
                            error!("persist settings on load: {}", e);
                        }
                    }
                    return settings;
                }
                Err(e) => {
                    error!("parse settings: {}", e);
                    Settings::default()
                }
            },
            Err(e) => {
                error!("read settings: {}", e);
                Settings::default()
            }
        }
    } else {
        Settings::default()
    };
    let migrated = migrate_settings(&mut settings);
    let text_changed = clamp_text_on_load(&mut settings.text);
    let action_keyboard_changed = normalize_action_keyboards(&mut settings);
    if migrated || text_changed || action_keyboard_changed {
        if let Err(e) = save_settings(&settings) {
            error!("persist settings on load: {}", e);
        }
    }
    settings
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
    // v4: show_workspace_badge_on_tab is now Option<bool>. The previous default was `true`
    // for all clients; treat that legacy default as "not explicitly set" so the device-based
    // default (mobile portrait on, desktop off) applies. An explicit `Some(false)` is kept.
    if settings.settings_version < 4 && settings.show_workspace_badge_on_tab == Some(true) {
        settings.show_workspace_badge_on_tab = None;
    }
    // v5: replace the tab-badge boolean with a four-state workspace badge mode.
    // Preserve explicit v4 choices while leaving an unset value device-aware.
    if settings.settings_version < 5 {
        if settings.workspace_badge_mode.is_none() {
            settings.workspace_badge_mode = settings.show_workspace_badge_on_tab.map(|show| {
                if show {
                    WorkspaceBadgeMode::Tab
                } else {
                    WorkspaceBadgeMode::Off
                }
            });
        }
        settings.show_workspace_badge_on_tab = None;
    }
    // v6: drop `status_bar` field (StatusBarSettings struct removed); plugin series
    // visibility moved to `monitor.plugin_series`. serde silently ignores the legacy
    // `status_bar` key on old configs. No data to migrate - plugin series start fresh.
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
    let _ = migrate_settings(&mut new_settings);
    new_settings.settings_version = CURRENT_SETTINGS_VERSION;
    let _ = clamp_text_config(&mut new_settings.text);
    let _ = clamp_theme_on_put(&mut new_settings);
    let _ = normalize_action_keyboards(&mut new_settings);
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

/// Initialize the global tracing subscriber based on `settings.log`.
///
/// When `log.enabled` is true, mounts both a stderr layer and a non-blocking
/// file appender writing to `log.path` (or `log_file_path()` if unset), and
/// returns a `WorkerGuard` the caller must keep alive for the process
/// lifetime to ensure buffered writes are flushed. When disabled, mounts a
/// stderr-only subscriber and returns `None`.
///
/// Shared by the `dinotty serve` CLI (`src/main.rs`) and the Tauri desktop /
/// embedded server (`src-tauri/src/main.rs`) so every entry point honors
/// `settings.log.*` uniformly.
///
/// # Panics
///
/// Panics on failure to create the log directory or open the log file,
/// matching prior inline behavior - a misconfigured `log.path` should
/// surface loudly rather than silently swallow logs.
#[must_use]
pub fn init_logging() -> Option<tracing_appender::non_blocking::WorkerGuard> {
    let settings = load_settings();

    let env_filter = || {
        tracing_subscriber::EnvFilter::new(
            std::env::var("RUST_LOG").unwrap_or_else(|_| "info".into()),
        )
    };

    if !settings.log.enabled {
        tracing_subscriber::registry()
            .with(env_filter())
            .with(tracing_subscriber::fmt::layer())
            .init();
        return None;
    }

    let log_path = if settings.log.path.is_empty() {
        let dir = log_dir();
        std::fs::create_dir_all(&dir).expect("failed to create log directory");
        log_file_path()
    } else {
        let path = PathBuf::from(&settings.log.path);
        if let Some(parent) = path.parent() {
            std::fs::create_dir_all(parent).expect("failed to create log directory");
        }
        path
    };

    let max_bytes = settings.log.max_size_mb * 1024 * 1024;
    if log_path.exists() {
        if let Ok(metadata) = std::fs::metadata(&log_path) {
            if metadata.len() > max_bytes {
                let backup_path = log_path.with_extension("log.1");
                let _ = std::fs::rename(&log_path, &backup_path);
            }
        }
    }

    let file = std::fs::OpenOptions::new()
        .append(true)
        .create(true)
        .open(&log_path)
        .expect("failed to create log file");

    let (non_blocking, guard) = tracing_appender::non_blocking(file);

    tracing_subscriber::registry()
        .with(env_filter())
        .with(tracing_subscriber::fmt::layer().with_writer(std::io::stderr))
        .with(tracing_subscriber::fmt::layer().with_writer(non_blocking))
        .init();

    tracing::info!("File logging enabled: {:?}", log_path);
    Some(guard)
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

#[cfg(test)]
mod action_key_display_tests {
    use super::{normalize_action_keyboards, ActionKeyboardConfig, Settings};

    fn parse_config(json: &str) -> ActionKeyboardConfig {
        serde_json::from_str(json).expect("action keyboard config should deserialize")
    }

    #[test]
    fn valid_display_values_survive_put_normalization_and_round_trip() {
        let config = parse_config(
            r#"{"rows":[[
                {"label":"Icon","kind":"action","action":"newTab","display":"icon"},
                {"label":"Text","kind":"action","action":"newTab","display":"text"}
            ]]}"#,
        );
        let mut settings = Settings {
            action_keyboard: Some(config.clone()),
            action_keyboard_user_default: Some(config),
            ..Settings::default()
        };

        normalize_action_keyboards(&mut settings);
        let wire = serde_json::to_string(&settings).unwrap();
        let round_tripped: Settings = serde_json::from_str(&wire).unwrap();

        for config in [
            round_tripped.action_keyboard.unwrap(),
            round_tripped.action_keyboard_user_default.unwrap(),
        ] {
            assert_eq!(config.rows[0][0].display.as_deref(), Some("icon"));
            assert_eq!(config.rows[0][1].display.as_deref(), Some("text"));
        }
    }

    #[test]
    fn bogus_display_normalizes_to_none_without_rejecting_payload() {
        let mut config = parse_config(
            r#"{"rows":[[{"label":"Future","kind":"action","action":"newTab","display":"bogus"}]]}"#,
        );

        config.normalize();

        assert_eq!(config.rows[0][0].display, None);
    }

    #[test]
    fn absent_display_is_omitted_from_serialized_output() {
        let mut config = parse_config(
            r#"{"rows":[[{"label":"New tab","kind":"action","action":"newTab","display":"bogus"}]]}"#,
        );
        config.normalize();

        let wire = serde_json::to_value(&config).unwrap();

        assert!(wire["rows"][0][0].get("display").is_none());
    }
}

#[cfg(test)]
mod space_confirms_dialogs_tests {
    use super::Settings;

    #[test]
    fn space_confirms_dialogs_defaults_to_false() {
        let settings: Settings = serde_json::from_str(r"{}").unwrap();
        assert!(!settings.space_confirms_dialogs);
    }

    #[test]
    fn space_confirms_dialogs_round_trips() {
        let settings: Settings =
            serde_json::from_str(r#"{"space_confirms_dialogs":true}"#).unwrap();
        assert!(settings.space_confirms_dialogs);

        let serialized = serde_json::to_string(&settings).unwrap();
        let round_tripped: Settings = serde_json::from_str(&serialized).unwrap();
        assert!(round_tripped.space_confirms_dialogs);
    }
}
