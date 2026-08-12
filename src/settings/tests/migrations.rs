use super::super::types::KeyboardGuardMode;
use super::super::*;

#[test]
fn v7_migrates_all_legacy_keyboard_guard_values_idempotently_and_stably() {
    for (legacy_json, expected) in [
        (
            r#"{"settings_version":6,"keyboard_keep_on_scroll":true}"#,
            KeyboardGuardMode::CollapseOnly,
        ),
        (r#"{"settings_version":6,"keyboard_keep_on_scroll":false}"#, KeyboardGuardMode::Off),
        (r#"{"settings_version":6}"#, KeyboardGuardMode::Off),
    ] {
        let mut settings: Settings = serde_json::from_str(legacy_json).unwrap();

        assert!(migrate_settings(&mut settings));
        assert_eq!(settings.settings_version, CURRENT_SETTINGS_VERSION);
        assert_eq!(settings.keyboard_guard_mode, expected);
        assert!(!migrate_settings(&mut settings));

        let first_save = serde_json::to_string(&settings).unwrap();
        assert!(!first_save.contains("keyboard_keep_on_scroll"));
        let mut loaded: Settings = serde_json::from_str(&first_save).unwrap();
        assert!(!migrate_settings(&mut loaded));
        let second_save = serde_json::to_string(&loaded).unwrap();

        assert_eq!(second_save.as_bytes(), first_save.as_bytes());
    }
}

#[test]
fn legacy_keyboard_bool_deserialization_is_field_local_and_tolerant() {
    for invalid in [serde_json::Value::Null, serde_json::json!("yes"), serde_json::json!(1)] {
        let json = serde_json::json!({
            "settings_version": 6,
            "keyboard_keep_on_scroll": invalid,
            "locale": "en"
        });
        let mut settings: Settings = serde_json::from_value(json).unwrap();

        assert!(!settings.keyboard_keep_on_scroll);
        assert_eq!(settings.locale, "en");
        assert!(migrate_settings(&mut settings));
        assert_eq!(settings.settings_version, CURRENT_SETTINGS_VERSION);
        assert_eq!(settings.keyboard_guard_mode, KeyboardGuardMode::Off);
        assert_eq!(settings.locale, "en");
    }
}

#[test]
fn v8_clone_flows_into_v9_system_upper_once() {
    let mut settings: Settings = serde_json::from_str(
        r#"{"settings_version":7,"toolbar_quick_keys":[{"label":"Esc","send":"\\u001b"}]}"#,
    )
    .unwrap();

    assert!(migrate_settings(&mut settings));
    assert_eq!(settings.settings_version, CURRENT_SETTINGS_VERSION);
    assert!(settings.system_toolbar_quick_keys.is_empty());
    let system = settings.system_keyboard.as_ref().unwrap();
    assert_eq!(system.upper.last(), settings.toolbar_quick_keys.last());

    settings.toolbar_quick_keys.clear();
    assert!(!migrate_settings(&mut settings));
    assert_eq!(settings.system_keyboard.as_ref().unwrap().upper.last().unwrap().label, "Esc");
}

#[test]
fn old_settings_migrate_legacy_upload_dir_once() {
    let mut settings = Settings {
        settings_version: 0,
        upload_dir: "~/.dinotty/uploads".into(),
        ..Settings::default()
    };

    assert!(migrate_settings(&mut settings));
    assert_eq!(settings.settings_version, CURRENT_SETTINGS_VERSION);
    assert_eq!(settings.upload_dir, default_upload_dir());
}

#[test]
fn old_settings_migrate_resolved_temp_upload_dir_once() {
    let mut settings = Settings {
        settings_version: 1,
        upload_dir: std::env::temp_dir().join("dinotty").to_string_lossy().into_owned(),
        ..Settings::default()
    };

    assert!(migrate_settings(&mut settings));
    assert_eq!(settings.settings_version, CURRENT_SETTINGS_VERSION);
    assert_eq!(settings.upload_dir, default_upload_dir());
}

#[test]
fn current_settings_keep_explicit_legacy_upload_dir() {
    let mut settings = Settings {
        settings_version: CURRENT_SETTINGS_VERSION,
        upload_dir: "~/.dinotty/uploads".into(),
        ..Settings::default()
    };

    assert!(!migrate_settings(&mut settings));
    assert_eq!(settings.settings_version, CURRENT_SETTINGS_VERSION);
    assert_eq!(settings.upload_dir, "~/.dinotty/uploads");
}

#[test]
fn v5_migrates_all_legacy_workspace_badge_values_idempotently() {
    for (legacy, expected) in [
        (Some(false), Some(WorkspaceBadgeMode::Off)),
        (Some(true), Some(WorkspaceBadgeMode::Tab)),
        (None, None),
    ] {
        let mut settings = Settings {
            settings_version: 4,
            show_workspace_badge_on_tab: legacy,
            workspace_badge_mode: None,
            ..Settings::default()
        };

        assert!(migrate_settings(&mut settings));
        assert_eq!(settings.settings_version, CURRENT_SETTINGS_VERSION);
        assert_eq!(settings.workspace_badge_mode, expected);
        assert_eq!(settings.show_workspace_badge_on_tab, None);

        let migrated = serde_json::to_string(&settings).unwrap();
        assert!(!migrated.contains("show_workspace_badge_on_tab"));
        assert!(!migrate_settings(&mut settings));
        assert_eq!(serde_json::to_string(&settings).unwrap(), migrated);
    }
}

#[test]
fn v4_put_migrates_explicitly_hidden_workspace_badge_to_off() {
    let mut settings = Settings {
        settings_version: 4,
        show_workspace_badge_on_tab: Some(false),
        workspace_badge_mode: None,
        ..Settings::default()
    };

    migrate_settings(&mut settings);

    assert_eq!(settings.workspace_badge_mode, Some(WorkspaceBadgeMode::Off));
}

#[test]
fn v4_put_migrates_explicitly_shown_workspace_badge_to_tab() {
    let mut settings = Settings {
        settings_version: 4,
        show_workspace_badge_on_tab: Some(true),
        workspace_badge_mode: None,
        ..Settings::default()
    };

    migrate_settings(&mut settings);

    assert_eq!(settings.workspace_badge_mode, Some(WorkspaceBadgeMode::Tab));
}

#[test]
fn v3_put_keeps_historical_workspace_badge_default_device_aware() {
    let mut settings = Settings {
        settings_version: 3,
        show_workspace_badge_on_tab: Some(true),
        workspace_badge_mode: None,
        ..Settings::default()
    };

    migrate_settings(&mut settings);

    assert_eq!(settings.workspace_badge_mode, None);
}

#[test]
fn legacy_put_keeps_existing_workspace_badge_mode() {
    let mut settings = Settings {
        settings_version: 4,
        show_workspace_badge_on_tab: Some(false),
        workspace_badge_mode: Some(WorkspaceBadgeMode::Both),
        ..Settings::default()
    };

    migrate_settings(&mut settings);

    assert_eq!(settings.workspace_badge_mode, Some(WorkspaceBadgeMode::Both));
}

#[test]
fn migrated_workspace_badge_mode_is_stable_across_save_load_save() {
    let mut settings = Settings {
        settings_version: 4,
        show_workspace_badge_on_tab: Some(true),
        workspace_badge_mode: None,
        ..Settings::default()
    };
    migrate_settings(&mut settings);

    let first_save = serde_json::to_string(&settings).unwrap();
    let mut loaded: Settings = serde_json::from_str(&first_save).unwrap();
    migrate_settings(&mut loaded);
    let second_save = serde_json::to_string(&loaded).unwrap();

    assert_eq!(loaded.workspace_badge_mode, Some(WorkspaceBadgeMode::Tab));
    assert_eq!(second_save, first_save);
}
