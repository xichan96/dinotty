#![allow(clippy::unwrap_used, clippy::expect_used)]

mod handlers;
mod io;
mod logging;
mod normalize;
mod types;

#[cfg(test)]
mod tests;

use std::path::PathBuf;

pub use handlers::{get_background, get_settings, put_settings, upload_background};
pub use io::{create_settings_state, load_settings, load_token, save_settings_sync, save_token};
pub use logging::{get_log, init_logging, log_dir, log_file_path};
pub use types::{
    default_upload_dir, ActionBottomCluster, ActionKey, ActionKeyboardConfig, AuthConfig,
    BackgroundConfig, BellNotificationConfig, CommandBookmark, CommandCompleteConfig, CustomColors,
    KeyBinding, KeywordRule, LogConfig, MonitorConfig, NotificationChannels, NotificationConfig,
    NotificationHook, NotificationSounds, NotificationType, OpenApiConfig, PanelPosition,
    PreviewConfig, RecentEntry, SavedTheme, SensitiveString, Settings, SettingsState, SoundConfig,
    SshAuthMethod, SshProfile, TextConfig, ThemeColors, ThemeConfig, WebBookmark,
    WorkspaceBadgeMode, WorkspaceBookmark, CURRENT_SETTINGS_VERSION,
};

#[cfg(test)]
pub(crate) use io::migrate_settings;
#[cfg(test)]
pub(crate) use normalize::{
    clamp_custom_fonts, clamp_quick_send_threshold, clamp_text_config, clamp_text_on_load,
    clamp_theme_on_put, normalize_action_keyboards,
};
#[cfg(test)]
pub(crate) use types::default_scroll_acceleration;

#[must_use]
pub fn config_dir() -> PathBuf {
    dirs::config_dir()
        .unwrap_or_else(|| PathBuf::from("."))
        .join(format!("dinotty{}", option_env!("DINOTTY_CONFIG_SUFFIX").unwrap_or("")))
}

#[cfg(test)]
mod action_key_display_tests {
    use super::normalize::normalize_action_keyboards;
    use super::types::{ActionKeyboardConfig, Settings};

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
    use super::types::Settings;

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
