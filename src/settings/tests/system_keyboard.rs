use super::super::*;

#[test]
fn v9_system_toolbar_mode_is_tolerant_and_defaults_to_follow_ime() {
    for value in [serde_json::Value::Null, serde_json::json!("future_mode"), serde_json::json!(7)] {
        let settings: Settings = serde_json::from_value(serde_json::json!({
            "settings_version": 9,
            "system_toolbar_mode": value,
        }))
        .unwrap();

        assert_eq!(settings.system_toolbar_mode, SystemToolbarMode::FollowIme);
    }
}

#[test]
fn v8_system_quick_keys_migrate_to_factory_upper_in_order() {
    let mut settings: Settings = serde_json::from_value(serde_json::json!({
        "settings_version": 8,
        "system_toolbar_quick_keys": [
            { "label": "first", "send": "1" },
            { "label": "second", "send": "2", "grow": 2.0 }
        ]
    }))
    .unwrap();

    assert!(migrate_settings(&mut settings));
    let config =
        settings.system_keyboard.as_ref().expect("legacy custom keys create a custom layout");
    let upper_labels: Vec<&str> = config.upper.iter().map(|key| key.label.as_str()).collect();
    assert_eq!(&upper_labels[..4], ["History", "Bookmarks", "Extended", "Actions"]);
    assert_eq!(&upper_labels[4..], ["first", "second"]);
    assert_eq!(config.upper[5].grow, Some(2.0));

    let lower_labels: Vec<&str> =
        config.pages.iter().flatten().map(|key| key.label.as_str()).collect();
    assert_eq!(
        lower_labels,
        ["Esc", "Tab", "Ctrl", "Alt", "/", "|", "~", "-", "^C", "^I", "^S", "^Z"]
    );
    assert_eq!(config.pages[0][2].special.as_deref(), Some("ctrl"));
    assert_eq!(config.pages[0][3].special.as_deref(), Some("alt"));
    assert_eq!(config.pages[0][2].display.as_deref(), Some("text"));
    assert_eq!(settings.system_toolbar_mode, SystemToolbarMode::FollowIme);

    let serialized = serde_json::to_value(&settings).unwrap();
    assert!(serialized.get("system_toolbar_quick_keys").is_none());
}

#[test]
fn v8_without_system_quick_keys_keeps_factory_sentinel() {
    let mut settings: Settings =
        serde_json::from_value(serde_json::json!({ "settings_version": 8 })).unwrap();

    assert!(migrate_settings(&mut settings));
    assert!(settings.system_keyboard.is_none());
    assert_eq!(settings.system_toolbar_mode, SystemToolbarMode::FollowIme);
}

#[test]
fn system_keyboard_normalization_repairs_pages_and_action_keys() {
    let mut settings = Settings {
        system_keyboard: Some(SystemKeyboardConfig {
            upper: vec![ActionKey {
                label: "bad".into(),
                kind: Some("unknown".into()),
                grow: Some(f64::INFINITY),
                ..ActionKey::default()
            }],
            pages: vec![],
            ..SystemKeyboardConfig::default()
        }),
        ..Settings::default()
    };

    assert!(normalize_action_keyboards(&mut settings));
    let config = settings.system_keyboard.as_ref().unwrap();
    assert_eq!(config.upper[0].kind.as_deref(), Some("send"));
    assert_eq!(config.upper[0].grow, None);
    assert_eq!(config.pages, vec![Vec::<ActionKey>::new()]);
}

#[test]
fn system_keyboard_normalization_clamps_both_pinned_prefixes_to_five() {
    let keys = || {
        (0..6)
            .map(|index| ActionKey { label: index.to_string(), ..ActionKey::default() })
            .collect::<Vec<_>>()
    };
    let mut settings = Settings {
        system_keyboard: Some(SystemKeyboardConfig {
            upper: keys(),
            pages: vec![keys()],
            upper_pinned: usize::MAX,
            lower_pinned: usize::MAX,
            ..SystemKeyboardConfig::default()
        }),
        ..Settings::default()
    };

    assert!(normalize_action_keyboards(&mut settings));
    let config = settings.system_keyboard.unwrap();
    assert_eq!((config.upper_pinned, config.lower_pinned), (5, 5));
}

#[test]
fn v9_null_layout_round_trips_as_an_intentional_factory_reset() {
    let settings: Settings = serde_json::from_value(serde_json::json!({
        "settings_version": 9,
        "system_keyboard": null,
        "system_toolbar_mode": "persistent_mobile"
    }))
    .unwrap();

    assert!(settings.system_keyboard.is_none());
    assert_eq!(settings.system_toolbar_mode, SystemToolbarMode::PersistentMobile);
    let serialized = serde_json::to_value(settings).unwrap();
    assert!(serialized["system_keyboard"].is_null());
    assert_eq!(serialized["system_toolbar_mode"], "persistent_mobile");
}

#[test]
fn stale_v8_put_preserves_stored_current_system_fields_only() {
    let stored_layout = SystemKeyboardConfig {
        upper: vec![ActionKey { label: "synced".into(), send: "s".into(), ..ActionKey::default() }],
        pages: vec![vec![]],
        ..SystemKeyboardConfig::default()
    };
    let existing = Settings {
        settings_version: CURRENT_SETTINGS_VERSION,
        system_keyboard: Some(stored_layout.clone()),
        system_toolbar_mode: SystemToolbarMode::PersistentMobile,
        locale: "zh".into(),
        ..Settings::default()
    };
    let mut incoming = Settings {
        settings_version: 9,
        system_keyboard: None,
        system_toolbar_mode: SystemToolbarMode::FollowIme,
        locale: "en".into(),
        ..Settings::default()
    };

    preserve_current_settings_on_legacy_put(None, &mut incoming, &existing);

    assert_eq!(incoming.system_keyboard, Some(stored_layout));
    assert_eq!(incoming.system_toolbar_mode, SystemToolbarMode::PersistentMobile);
    assert_eq!(incoming.locale, "en");
}

#[test]
fn current_put_can_reset_system_layout_and_policy() {
    let existing = Settings {
        system_keyboard: Some(SystemKeyboardConfig {
            upper: vec![ActionKey { label: "stored".into(), ..ActionKey::default() }],
            pages: vec![vec![]],
            ..SystemKeyboardConfig::default()
        }),
        system_toolbar_mode: SystemToolbarMode::PersistentMobile,
        ..Settings::default()
    };
    let mut incoming = Settings {
        system_keyboard: None,
        system_toolbar_mode: SystemToolbarMode::FollowIme,
        ..Settings::default()
    };

    preserve_current_settings_on_legacy_put(
        Some(CURRENT_SETTINGS_VERSION),
        &mut incoming,
        &existing,
    );

    assert!(incoming.system_keyboard.is_none());
    assert_eq!(incoming.system_toolbar_mode, SystemToolbarMode::FollowIme);
}

#[test]
fn v9_layout_migrates_to_v10_flat_stream_without_reordering_or_loss() {
    let mut settings: Settings = serde_json::from_value(serde_json::json!({
        "settings_version": 9,
        "system_keyboard": {
            "upper": [{ "label": "upper", "send": "u", "grow": 2.6 }],
            "pages": [
                [{ "label": "one", "send": "1" }],
                [{ "label": "two", "send": "2" }, { "label": "three", "send": "3" }]
            ]
        }
    }))
    .unwrap();

    assert!(migrate_settings(&mut settings));
    assert_eq!(settings.settings_version, CURRENT_SETTINGS_VERSION);
    let config = settings.system_keyboard.as_ref().unwrap();
    assert_eq!(config.pages.len(), 1);
    assert_eq!(
        config.pages[0].iter().map(|key| key.label.as_str()).collect::<Vec<_>>(),
        ["one", "two", "three"]
    );
    assert!(config.lower_enabled);
    assert_eq!(config.upper_pinned, 0);
    assert_eq!(config.lower_pinned, 0);
    assert_eq!(config.upper[0].grow, Some(3.0));
}

#[test]
fn v10_system_fields_and_integer_widths_round_trip() {
    let mut settings: Settings = serde_json::from_value(serde_json::json!({
        "settings_version": 10,
        "system_keyboard": {
            "upper": [{ "label": "first", "send": "1", "grow": 20 }],
            "pages": [[{ "label": "saved", "send": "s", "grow": 20 }]],
            "lower_enabled": false,
            "upper_pinned": 9,
            "lower_pinned": 9
        }
    }))
    .unwrap();

    assert!(normalize_action_keyboards(&mut settings));
    let config = settings.system_keyboard.as_ref().unwrap();
    assert!(!config.lower_enabled);
    assert_eq!(config.upper_pinned, 1);
    assert_eq!(config.lower_pinned, 1);
    assert_eq!(config.upper[0].grow, Some(9.0));
    assert_eq!(config.pages[0][0].grow, Some(10.0));

    let wire = serde_json::to_string(&settings).unwrap();
    let loaded: Settings = serde_json::from_str(&wire).unwrap();
    let loaded = loaded.system_keyboard.unwrap();
    assert!(!loaded.lower_enabled);
    assert_eq!(loaded.upper_pinned, 1);
    assert_eq!(loaded.lower_pinned, 1);
}

#[test]
fn v11_system_user_default_round_trips_and_normalizes_like_the_active_layout() {
    let mut settings: Settings = serde_json::from_value(serde_json::json!({
        "settings_version": 11,
        "system_keyboard_user_default": {
            "upper": [{ "label": "saved", "send": "s", "grow": 20 }],
            "pages": [[{ "label": "lower", "send": "l", "grow": 20 }]],
            "lower_enabled": false,
            "upper_pinned": 9,
            "lower_pinned": 9
        }
    }))
    .unwrap();

    assert!(normalize_action_keyboards(&mut settings));
    let saved = settings.system_keyboard_user_default.as_ref().unwrap();
    assert_eq!(saved.upper[0].grow, Some(9.0));
    assert_eq!(saved.pages[0][0].grow, Some(10.0));
    assert_eq!(saved.upper_pinned, 1);
    assert_eq!(saved.lower_pinned, 1);
    assert!(!saved.lower_enabled);

    let wire = serde_json::to_string(&settings).unwrap();
    let loaded: Settings = serde_json::from_str(&wire).unwrap();
    assert_eq!(loaded.system_keyboard_user_default, settings.system_keyboard_user_default);
}

#[test]
fn v11_layout_migrates_to_v12_with_lower_pinning_disabled_by_default() {
    let mut settings: Settings = serde_json::from_value(serde_json::json!({
        "settings_version": 11,
        "system_keyboard": {
            "upper": [],
            "pages": [[{ "label": "lower", "send": "l" }]],
            "upper_pinned": 0
        }
    }))
    .unwrap();

    assert!(migrate_settings(&mut settings));
    assert_eq!(settings.settings_version, CURRENT_SETTINGS_VERSION);
    assert_eq!(settings.system_keyboard.unwrap().lower_pinned, 0);
}

#[test]
fn stale_v11_put_preserves_the_v12_system_layout_and_user_default() {
    let snapshot: SystemKeyboardConfig = serde_json::from_value(serde_json::json!({
        "upper": [{ "label": "saved", "send": "s" }],
        "pages": [[{ "label": "lower", "send": "l" }]],
        "lower_pinned": 1
    }))
    .unwrap();
    let existing = Settings {
        settings_version: CURRENT_SETTINGS_VERSION,
        system_keyboard: Some(snapshot.clone()),
        system_keyboard_user_default: Some(snapshot.clone()),
        system_toolbar_mode: SystemToolbarMode::PersistentMobile,
        ..Settings::default()
    };
    let mut incoming = Settings {
        settings_version: CURRENT_SETTINGS_VERSION,
        system_keyboard: None,
        system_keyboard_user_default: None,
        system_toolbar_mode: SystemToolbarMode::FollowIme,
        ..Settings::default()
    };

    preserve_current_settings_on_legacy_put(None, &mut incoming, &existing);

    assert_eq!(incoming.system_keyboard, Some(snapshot.clone()));
    assert_eq!(incoming.system_keyboard_user_default, Some(snapshot));
    assert_eq!(incoming.system_toolbar_mode, SystemToolbarMode::PersistentMobile);
}

#[test]
fn stale_v9_put_preserves_stored_v10_system_fields_without_blocking_locale() {
    let stored_layout: SystemKeyboardConfig = serde_json::from_value(serde_json::json!({
        "upper": [{ "label": "synced", "send": "s" }],
        "pages": [[{ "label": "lower", "send": "l" }]],
        "lower_enabled": false,
        "upper_pinned": 1
    }))
    .unwrap();
    let existing = Settings {
        settings_version: CURRENT_SETTINGS_VERSION,
        system_keyboard: Some(stored_layout.clone()),
        system_toolbar_mode: SystemToolbarMode::PersistentMobile,
        locale: "zh".into(),
        ..Settings::default()
    };
    let mut incoming = Settings {
        settings_version: 10,
        system_keyboard: None,
        system_toolbar_mode: SystemToolbarMode::FollowIme,
        locale: "en".into(),
        ..Settings::default()
    };

    preserve_current_settings_on_legacy_put(None, &mut incoming, &existing);

    assert_eq!(incoming.system_keyboard, Some(stored_layout));
    assert_eq!(incoming.system_toolbar_mode, SystemToolbarMode::PersistentMobile);
    assert_eq!(incoming.locale, "en");
}

#[test]
fn v12_put_can_reset_v12_system_layout_and_policy() {
    let existing = Settings {
        settings_version: 12,
        system_keyboard: serde_json::from_value(serde_json::json!({
            "upper": [], "pages": [[]], "lower_enabled": false, "upper_pinned": 0
        }))
        .unwrap(),
        system_toolbar_mode: SystemToolbarMode::PersistentMobile,
        ..Settings::default()
    };
    let mut incoming = Settings {
        settings_version: CURRENT_SETTINGS_VERSION,
        system_keyboard: None,
        system_toolbar_mode: SystemToolbarMode::FollowIme,
        ..Settings::default()
    };

    preserve_current_settings_on_legacy_put(Some(12), &mut incoming, &existing);

    assert!(incoming.system_keyboard.is_none());
    assert_eq!(incoming.system_toolbar_mode, SystemToolbarMode::FollowIme);
}

#[test]
fn client_settings_version_is_request_only_and_never_serialized() {
    let settings: Settings = serde_json::from_value(serde_json::json!({
        "settings_version": CURRENT_SETTINGS_VERSION,
        "client_settings_version": CURRENT_SETTINGS_VERSION
    }))
    .unwrap();

    assert_eq!(settings.client_settings_version, Some(CURRENT_SETTINGS_VERSION));
    assert!(serde_json::to_value(settings).unwrap().get("client_settings_version").is_none());
}
