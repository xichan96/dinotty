use std::path::PathBuf;
use tracing::error;

use super::normalize::{
    clamp_quick_send_threshold, clamp_text_config, clamp_text_on_load, normalize_action_keyboards,
};
use super::types::{
    default_upload_dir, ActionKey, KeyboardGuardMode, Settings, SystemKeyboardConfig,
    SystemToolbarMode, WorkspaceBadgeMode, CURRENT_SETTINGS_VERSION, LEGACY_UPLOAD_DIR,
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
    // v8: quick-keyboard and system-IME toolbars are configured independently.
    // Clone the formerly shared list so upgrading does not make either toolbar lose keys.
    if settings.settings_version < 8 {
        settings.system_toolbar_quick_keys = settings.toolbar_quick_keys.clone();
    }
    // v9: replace the fixed system-IME toolbar with one synchronized, fully customizable layout.
    // `None` is the factory sentinel, so an empty legacy custom row remains a resettable default.
    if settings.settings_version < 9 {
        settings.system_toolbar_mode = SystemToolbarMode::FollowIme;
        if settings.system_toolbar_quick_keys.is_empty() {
            settings.system_keyboard = None;
        } else {
            let mut config = factory_system_keyboard();
            config.upper.append(&mut settings.system_toolbar_quick_keys);
            settings.system_keyboard = Some(config);
        }
    }
    // v10: pages are now a wire-compatible carrier for one complete ordered lower stream.
    // Runtime derives whole pages from integer grid units, so legacy manual page boundaries
    // are flattened without dropping or reordering any key.
    if settings.settings_version < 10 {
        if let Some(config) = settings.system_keyboard.as_mut() {
            config.pages = vec![config.pages.drain(..).flatten().collect()];
            config.lower_enabled = true;
            config.upper_pinned = 0;
            config.lower_pinned = 0;
            for key in config.upper.iter_mut().chain(config.pages[0].iter_mut()) {
                if let Some(grow) = key.grow {
                    key.grow = grow.is_finite().then(|| grow.round().clamp(1.0, 10.0));
                }
            }
        }
    }
    // v11 adds a synchronized user-default snapshot for the complete system-IME toolbar.
    // The optional field uses its serde default, so existing layouts need no data transform.
    // v12 adds an independent lower pinned prefix and expands both pinned limits to five.
    // Serde defaults legacy lower counts to zero while existing upper counts remain intact.
    settings.settings_version = CURRENT_SETTINGS_VERSION;
    true
}

fn system_action(label: &str, action: &str) -> ActionKey {
    ActionKey {
        label: label.to_string(),
        kind: Some("action".to_string()),
        action: Some(action.to_string()),
        ..ActionKey::default()
    }
}

fn system_send(label: &str, send: &str) -> ActionKey {
    ActionKey {
        label: label.to_string(),
        kind: Some("send".to_string()),
        send: send.to_string(),
        ..ActionKey::default()
    }
}

pub(crate) fn factory_system_keyboard() -> SystemKeyboardConfig {
    let mut ctrl = system_send("Ctrl", "");
    ctrl.special = Some("ctrl".to_string());
    ctrl.display = Some("text".to_string());
    let mut alt = system_send("Alt", "");
    alt.special = Some("alt".to_string());
    alt.display = Some("text".to_string());

    SystemKeyboardConfig {
        upper: vec![
            system_action("History", "system.history"),
            system_action("Bookmarks", "openBookmarks"),
            system_action("Extended", "system.extended"),
            system_action("Actions", "system.actions"),
        ],
        pages: vec![
            vec![
                system_send("Esc", "\u{1b}"),
                system_send("Tab", "\t"),
                ctrl,
                alt,
                system_send("/", "/"),
                system_send("|", "|"),
            ],
            vec![
                system_send("~", "~"),
                system_send("-", "-"),
                system_send("^C", "\u{3}"),
                system_send("^I", "\t"),
                system_send("^S", "\u{13}"),
                system_send("^Z", "\u{1a}"),
            ],
        ],
        lower_enabled: true,
        upper_pinned: 0,
        lower_pinned: 0,
    }
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
