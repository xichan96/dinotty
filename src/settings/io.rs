use std::path::PathBuf;
use tracing::error;

use super::normalize::{
    clamp_quick_send_threshold, clamp_text_config, clamp_text_on_load, normalize_action_keyboards,
};
use super::types::{
    default_upload_dir, KeyboardGuardMode, Settings, WorkspaceBadgeMode, CURRENT_SETTINGS_VERSION,
    LEGACY_UPLOAD_DIR,
};
use super::{config_dir, SettingsState};

fn settings_path() -> PathBuf {
    config_dir().join("settings.json")
}

pub(crate) fn token_path() -> PathBuf {
    config_dir().join("token")
}

pub(crate) fn bg_image_path() -> PathBuf {
    config_dir().join("bg.webp")
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
                    let threshold_changed = clamp_quick_send_threshold(&mut settings);
                    let action_keyboard_changed = normalize_action_keyboards(&mut settings);
                    if migrated || text_changed || threshold_changed || action_keyboard_changed {
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
    let threshold_changed = clamp_quick_send_threshold(&mut settings);
    let action_keyboard_changed = normalize_action_keyboards(&mut settings);
    if migrated || text_changed || threshold_changed || action_keyboard_changed {
        if let Err(e) = save_settings(&settings) {
            error!("persist settings on load: {}", e);
        }
    }
    settings
}

pub(crate) fn migrate_settings(settings: &mut Settings) -> bool {
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
    // v7: replace the keep-on-scroll boolean with the keyboard guard mode.
    if settings.settings_version < 7 {
        settings.keyboard_guard_mode = if settings.keyboard_keep_on_scroll {
            KeyboardGuardMode::CollapseOnly
        } else {
            KeyboardGuardMode::Off
        };
    }
    settings.settings_version = CURRENT_SETTINGS_VERSION;
    true
}

pub(crate) fn save_settings(settings: &Settings) -> Result<(), String> {
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

#[must_use]
pub fn create_settings_state() -> SettingsState {
    std::sync::Arc::new(tokio::sync::RwLock::new(load_settings()))
}
