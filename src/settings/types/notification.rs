use serde::{Deserialize, Serialize};

use super::default_true;

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
