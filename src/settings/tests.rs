use super::*;

#[test]
fn old_config_missing_confirm_before_close_tab_defaults_to_true() {
    let old_config = r"{}";
    let settings: Settings = serde_json::from_str(old_config)
        .expect("old config without confirm_before_close_tab should still parse");
    assert!(
        settings.confirm_before_close_tab,
        "missing field should default to true for backward compatibility"
    );
}

#[test]
fn settings_defaults_locale_to_zh() {
    let settings: Settings = serde_json::from_str(r"{}").unwrap();
    assert_eq!(settings.locale, "zh");
}

#[test]
fn settings_empty_json_is_valid() {
    let settings: Settings = serde_json::from_str(r"{}").unwrap();
    assert_eq!(settings.settings_version, 0);
    assert!(!settings.keyboard_sound);
    assert!(!settings.show_virtual_keyboard);
    assert!(!settings.windows_alt_as_cmd);
    assert!(settings.confirm_before_close_tab);
    assert!(settings.bookmarks.is_empty());
    if cfg!(feature = "server") {
        assert!(settings.ip_whitelist.is_empty());
    } else {
        assert_eq!(settings.ip_whitelist, vec!["127.0.0.1", "::1"]);
    }
    assert_eq!(settings.upload_dir, default_upload_dir());
}

#[test]
fn old_settings_without_default_workspace_identity_still_deserialize() {
    let settings: Settings = serde_json::from_str(r#"{"default_workspace_root":"/tmp/work"}"#)
        .expect("settings written before default workspace identity should still parse");

    assert_eq!(settings.default_workspace_root.as_deref(), Some("/tmp/work"));
    assert_eq!(settings.default_workspace_name, None);
    assert_eq!(settings.default_workspace_abbr, None);
    assert_eq!(settings.default_workspace_color, None);
    assert_eq!(settings.default_workspace_tab_badge, None);
}

#[test]
fn default_workspace_identity_survives_settings_round_trip() {
    let settings = Settings {
        default_workspace_name: Some("Home".into()),
        default_workspace_abbr: Some("HM".into()),
        default_workspace_color: Some("#123456".into()),
        default_workspace_tab_badge: Some(false),
        ..Settings::default()
    };

    let serialized = serde_json::to_string(&settings).unwrap();
    let restored: Settings = serde_json::from_str(&serialized).unwrap();

    assert_eq!(restored.default_workspace_name.as_deref(), Some("Home"));
    assert_eq!(restored.default_workspace_abbr.as_deref(), Some("HM"));
    assert_eq!(restored.default_workspace_color.as_deref(), Some("#123456"));
    assert_eq!(restored.default_workspace_tab_badge, Some(false));
}

// 验证后端能反序列化前端使用的 windowsAltAsCmd camelCase 字段。
#[test]
fn settings_deserializes_windows_alt_as_cmd_camel_case() {
    let settings: Settings = serde_json::from_str(r#"{"windowsAltAsCmd": true}"#).unwrap();

    assert!(settings.windows_alt_as_cmd);
}

// 验证后端序列化仍输出 windowsAltAsCmd，避免生成 snake_case 配置。
#[test]
fn settings_serializes_windows_alt_as_cmd_camel_case() {
    let mut settings: Settings = serde_json::from_str(r#"{}"#).unwrap();
    settings.windows_alt_as_cmd = true;

    let serialized = serde_json::to_string(&settings).unwrap();

    assert!(serialized.contains(r#""windowsAltAsCmd":true"#));
    assert!(!serialized.contains("windows_alt_as_cmd"));
}

#[test]
fn settings_with_custom_values() {
    let json = r#"{
        "theme": {"name": "dracula"},
        "locale": "en",
        "keyboard_sound": true,
        "confirm_before_close_tab": false
    }"#;
    let settings: Settings = serde_json::from_str(json).unwrap();
    assert_eq!(settings.locale, "en");
    assert!(settings.keyboard_sound);
    assert!(!settings.confirm_before_close_tab);
}

#[test]
fn settings_auth_token_is_skipped_in_serde() {
    let json = r#"{"auth_token": "should_be_ignored"}"#;
    let settings: Settings = serde_json::from_str(json).unwrap();
    assert!(settings.auth_token.is_empty());

    let mut settings2: Settings = serde_json::from_str(r"{}").unwrap();
    settings2.auth_token = "my_token".to_string();
    let serialized = serde_json::to_string(&settings2).unwrap();
    assert!(!serialized.contains("my_token"));
}

#[test]
fn settings_monitor_defaults() {
    let settings: Settings = serde_json::from_str(r"{}").unwrap();
    assert!(settings.monitor.enabled);
    assert!(settings.monitor.cpu);
}

#[test]
fn settings_notification_defaults() {
    let settings: Settings = serde_json::from_str(r"{}").unwrap();
    assert!(settings.notification.enabled);
    assert!(!settings.notification.idle_reminder);
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

#[test]
fn legacy_text_config_without_custom_fonts_deserializes_to_none() {
    let settings: Settings = serde_json::from_str(r#"{"text":{"font_family":"Monaco"}}"#).unwrap();
    assert_eq!(settings.text.custom_fonts, None);
}

#[test]
fn clamp_text_on_load_leaves_missing_custom_fonts_none() {
    let mut text = TextConfig::default();

    assert!(!clamp_text_on_load(&mut text));
    assert_eq!(text.custom_fonts, None);
}

#[test]
fn clamp_text_on_load_keeps_existing_custom_fonts_unchanged() {
    let mut text =
        TextConfig { custom_fonts: Some(vec!["Monaco".into()]), ..TextConfig::default() };

    assert!(!clamp_text_on_load(&mut text));
    assert_eq!(text.custom_fonts, Some(vec!["Monaco".into()]));
}

#[test]
fn clamp_text_on_load_keeps_empty_custom_fonts() {
    let mut text = TextConfig { custom_fonts: Some(Vec::new()), ..TextConfig::default() };

    assert!(!clamp_text_on_load(&mut text));
    assert_eq!(text.custom_fonts, Some(Vec::new()));
}

#[test]
fn clamp_custom_fonts_sanitizes_and_preserves_first_occurrence_order() {
    let too_long = "x".repeat(101);
    let mut fonts = vec![
        "  Fira Code  ".into(),
        "".into(),
        "   ".into(),
        too_long,
        "Bad\"Font".into(),
        "Bad\\Font".into(),
        "Bad\nFont".into(),
        "fira code".into(),
        "Menlo".into(),
        "menlo".into(),
        "monospace".into(),
        "JetBrains Mono".into(),
        "Source Code Pro".into(),
    ];

    assert!(clamp_custom_fonts(&mut fonts));
    assert_eq!(fonts, vec!["Fira Code", "JetBrains Mono", "Source Code Pro"]);
}

#[test]
fn clamp_custom_fonts_drops_anchor_in_stack_form() {
    let mut fonts = vec!["Menlo, monospace".into(), "Foo, Bar".into(), "  Spaced  ".into()];

    assert!(clamp_custom_fonts(&mut fonts));
    assert_eq!(fonts, vec!["Foo", "Spaced"]);
}

#[test]
fn clamp_custom_fonts_extracts_primary_from_quoted_stack() {
    let mut fonts = vec!["\"Fira Code\", monospace".into()];

    assert!(clamp_custom_fonts(&mut fonts));
    assert_eq!(fonts, vec!["Fira Code"]);
}

#[test]
fn clamp_custom_fonts_keeps_plain_non_anchor_unchanged() {
    let mut fonts = vec!["JetBrains Mono".into()];

    assert!(!clamp_custom_fonts(&mut fonts));
    assert_eq!(fonts, vec!["JetBrains Mono"]);
}

#[test]
fn clamp_custom_fonts_caps_at_twenty() {
    let mut fonts: Vec<String> = (0..25).map(|i| format!("Custom Font {i}")).collect();

    assert!(clamp_custom_fonts(&mut fonts));
    assert_eq!(fonts.len(), 20);
    assert_eq!(fonts.first().unwrap(), "Custom Font 0");
    assert_eq!(fonts.last().unwrap(), "Custom Font 19");
}

#[test]
fn clamp_text_config_reports_whether_it_mutated() {
    let mut unchanged =
        TextConfig { custom_fonts: Some(vec!["Monaco".into()]), ..TextConfig::default() };
    assert!(!clamp_text_config(&mut unchanged));

    let mut changed = TextConfig {
        scroll_sensitivity: 5.0,
        scroll_acceleration: f32::NAN,
        scrollbar_width: 2,
        custom_fonts: Some(vec![" Monaco ".into(), "MONACO".into()]),
        ..TextConfig::default()
    };
    assert!(clamp_text_config(&mut changed));
    assert!((changed.scroll_sensitivity - 2.0).abs() < f32::EPSILON);
    assert!((changed.scroll_acceleration - default_scroll_acceleration()).abs() < f32::EPSILON);
    assert_eq!(changed.scrollbar_width, 4);
    assert_eq!(changed.custom_fonts, Some(vec!["Monaco".into()]));
    assert!(!clamp_text_config(&mut changed));
}

#[test]
fn clamp_text_on_load_never_changes_orphan_font_family() {
    let mut text = TextConfig {
        font_family: "Orphan Font, monospace".into(),
        custom_fonts: Some(Vec::new()),
        ..TextConfig::default()
    };

    assert!(!clamp_text_on_load(&mut text));
    assert_eq!(text.font_family, "Orphan Font, monospace");
}

#[test]
fn clamp_text_on_load_preserves_empty_font_family() {
    let mut text = TextConfig::default();

    assert!(!clamp_text_on_load(&mut text));
    assert!(text.font_family.is_empty());
}

#[test]
fn clamp_text_on_load_neutralises_unsafe_font_family() {
    for font_family in ["a;b{}", "Bad\nFont"] {
        let mut text = TextConfig { font_family: font_family.into(), ..TextConfig::default() };

        assert!(clamp_text_on_load(&mut text));
        assert_eq!(text.font_family, "monospace");
    }
}

#[test]
fn clamp_text_on_load_keeps_legit_font_stack() {
    let mut text =
        TextConfig { font_family: "\"Fira Code\", monospace".into(), ..TextConfig::default() };

    assert!(!clamp_text_on_load(&mut text));
    assert_eq!(text.font_family, "\"Fira Code\", monospace");
}

#[test]
fn clamp_text_on_load_keeps_monospace_and_empty_font_family() {
    for font_family in ["monospace", ""] {
        let mut text = TextConfig { font_family: font_family.into(), ..TextConfig::default() };

        assert!(!clamp_text_on_load(&mut text));
        assert_eq!(text.font_family, font_family);
    }
}

#[test]
fn clamp_custom_fonts_drops_css_injection_vectors() {
    let mut fonts = vec![
        "Good Font".into(),
        "Evil<script>".into(),
        "Evil;drop".into(),
        "Evil{bad}".into(),
        "Evil>arrow".into(),
        "Another Good".into(),
    ];

    assert!(clamp_custom_fonts(&mut fonts));
    assert_eq!(fonts, vec!["Good Font", "Another Good"]);
}

fn sample_theme(uuid: &str, name: &str) -> SavedTheme {
    SavedTheme {
        uuid: uuid.to_string(),
        name: name.to_string(),
        colors: ThemeColors {
            foreground: "#ffffff".to_string(),
            background: "#000000".to_string(),
            cursor: "#ffffff".to_string(),
            ansi: std::array::from_fn(|_| "#000000".to_string()),
        },
    }
}

#[test]
fn old_settings_without_theme_library_defaults_empty() {
    let settings: Settings = serde_json::from_str(r"{}").unwrap();

    assert!(settings.custom_themes.is_empty());
    assert!(settings.hidden_builtins.is_empty());
}

#[test]
fn settings_round_trips_custom_themes() {
    let theme = sample_theme("theme-1", "Nord");
    let mut settings = Settings::default();
    settings.custom_themes.push(theme);

    let serialized = serde_json::to_string(&settings).unwrap();
    let restored: Settings = serde_json::from_str(&serialized).unwrap();
    let restored_theme = &restored.custom_themes[0];

    assert_eq!(restored_theme.uuid, "theme-1");
    assert_eq!(restored_theme.name, "Nord");
    assert_eq!(restored_theme.colors.foreground, "#ffffff");
    assert_eq!(restored_theme.colors.background, "#000000");
    assert_eq!(restored_theme.colors.cursor, "#ffffff");
    assert_eq!(restored_theme.colors.ansi, std::array::from_fn(|_| "#000000".to_string()));
}

#[test]
fn clamp_theme_on_put_dedups_uuid_keeping_first() {
    let mut settings = Settings {
        custom_themes: vec![sample_theme("same", "First"), sample_theme("same", "Second")],
        ..Default::default()
    };

    assert!(clamp_theme_on_put(&mut settings));
    assert_eq!(settings.custom_themes.len(), 1);
    assert_eq!(settings.custom_themes[0].name, "First");
}

fn parse_action_keyboard(json: &str) -> ActionKeyboardConfig {
    serde_json::from_str(json).expect("action keyboard config should deserialize")
}

#[test]
fn action_keyboard_serde_round_trips_old_and_new_shapes() {
    let old = parse_action_keyboard(r#"{"rows":[[{"label":"esc","send":"\u001b"}]]}"#);
    assert!(old.bottom.is_none());
    let old_round_trip: ActionKeyboardConfig =
        serde_json::from_str(&serde_json::to_string(&old).unwrap()).unwrap();
    assert_eq!(old_round_trip, old);

    let new = parse_action_keyboard(
        r#"{
            "rows":[[{"label":"New tab","kind":"action","action":"newTab"}]],
            "bottom":{
                "rows":[[{"label":"yes","send":"yes\r","grow":1.5}]],
                "enter":{"label":"Go","kind":"send","send":"\r"},
                "enter_width":0.28
            }
        }"#,
    );
    let new_round_trip: ActionKeyboardConfig =
        serde_json::from_str(&serde_json::to_string(&new).unwrap()).unwrap();
    assert_eq!(new_round_trip, new);

    let mut settings = Settings {
        action_keyboard: Some(new.clone()),
        action_keyboard_user_default: Some(new),
        ..Settings::default()
    };
    normalize_action_keyboards(&mut settings);
    let settings_round_trip: Settings =
        serde_json::from_str(&serde_json::to_string(&settings).unwrap()).unwrap();
    assert!(settings_round_trip.action_keyboard.is_some());
    assert!(settings_round_trip.action_keyboard_user_default.is_some());
}

#[test]
fn action_keyboard_plain_send_omits_absent_optional_fields() {
    let config = parse_action_keyboard(r#"{"rows":[[{"label":"esc","send":"\u001b"}]]}"#);
    let serialized = serde_json::to_value(&config).unwrap();
    let key = &serialized["rows"][0][0];

    assert!(key.get("kind").is_none());
    assert!(key.get("action").is_none());
    assert!(key.get("style").is_none());
    assert!(key.get("grow").is_none());

    let round_trip: ActionKeyboardConfig = serde_json::from_value(serialized).unwrap();
    assert_eq!(round_trip, config);
}

#[test]
fn action_keyboard_serde_ignores_unknown_fields_and_accepts_unknown_kind() {
    let config = parse_action_keyboard(
        r#"{
            "unknown_config_field":true,
            "rows":[[{
                "label":"future",
                "kind":"future-kind",
                "send":"kept",
                "unknown_key_field":{"future":true}
            }]],
            "bottom":{
                "rows":[],
                "enter":{"label":"Go","kind":"send","send":"\r"},
                "unknown_bottom_field":42
            }
        }"#,
    );
    assert_eq!(config.rows[0][0].kind.as_deref(), Some("future-kind"));
    assert_eq!(config.rows[0][0].send, "kept");

    let serialized = serde_json::to_string(&config).unwrap();
    assert!(!serialized.contains("unknown_config_field"));
    assert!(!serialized.contains("unknown_key_field"));
    assert!(!serialized.contains("unknown_bottom_field"));
    let round_trip: ActionKeyboardConfig = serde_json::from_str(&serialized).unwrap();
    assert_eq!(round_trip, config);
}

#[test]
fn action_keyboard_normalize_obeys_absence_and_empty_contract() {
    let mut settings = Settings::default();
    assert!(!normalize_action_keyboards(&mut settings));
    assert!(settings.action_keyboard.is_none());
    assert!(settings.action_keyboard_user_default.is_none());

    let mut legacy = parse_action_keyboard(r#"{"rows":[]}"#);
    legacy.normalize();
    assert!(legacy.bottom.is_none());

    let mut explicit_empty = parse_action_keyboard(
        r#"{"rows":[],"bottom":{"rows":[],"enter":{"label":"Go","kind":"send","send":"\r"}}}"#,
    );
    explicit_empty.normalize();
    assert!(explicit_empty.bottom.as_ref().unwrap().rows.is_empty());
}

#[test]
fn action_keyboard_normalize_repairs_every_invalid_enter_form() {
    let cases = [
        (r#"{"rows":[],"bottom":{"rows":[]}}"#, "↵"),
        (
            r#"{"rows":[],"bottom":{"rows":[],"enter":{"label":"Custom","kind":"action","action":"newTab"}}}"#,
            "Custom",
        ),
        (r#"{"rows":[],"bottom":{"rows":[],"enter":{"label":"No kind","send":"\r"}}}"#, "No kind"),
        (
            r#"{"rows":[],"bottom":{"rows":[],"enter":{"label":"Wrong bytes","kind":"send","send":"\n"}}}"#,
            "Wrong bytes",
        ),
        (r#"{"rows":[],"bottom":{"rows":[],"enter":{"label":"   ","kind":"send"}}}"#, "↵"),
    ];

    for (json, expected_label) in cases {
        let mut config = parse_action_keyboard(json);
        config.normalize();
        let enter = config.bottom.unwrap().enter.unwrap();
        assert_eq!(enter.label, expected_label);
        assert_eq!(enter.kind.as_deref(), Some("send"));
        assert_eq!(enter.send, "\r");
    }
}

#[test]
fn action_keyboard_normalize_clamps_width_and_grow_without_rounding() {
    for (input, expected) in [(-1.0, Some(0.15)), (0.3, Some(0.3)), (0.9, Some(0.5))] {
        let mut config = parse_action_keyboard(
            r#"{"rows":[],"bottom":{"rows":[],"enter":{"label":"Go","kind":"send","send":"\r"}}}"#,
        );
        config.bottom.as_mut().unwrap().enter_width = Some(input);
        config.normalize();
        assert_eq!(config.bottom.unwrap().enter_width, expected);
    }

    for input in [f64::NAN, f64::INFINITY, f64::NEG_INFINITY] {
        let mut config = parse_action_keyboard(
            r#"{"rows":[],"bottom":{"rows":[],"enter":{"label":"Go","kind":"send","send":"\r"}}}"#,
        );
        config.bottom.as_mut().unwrap().enter_width = Some(input);
        config.normalize();
        assert_eq!(config.bottom.unwrap().enter_width, None);
    }

    let mut config = parse_action_keyboard(
        r#"{
            "rows":[[
                {"label":"low","grow":-1},
                {"label":"fractional","grow":1.75},
                {"label":"high","grow":20},
                {"label":"nan"}
            ]],
            "bottom":{
                "rows":[[{"label":"infinite"}]],
                "enter":{"label":"Go","kind":"send","send":"\r","grow":20}
            }
        }"#,
    );
    config.rows[0][3].grow = Some(f64::NAN);
    config.bottom.as_mut().unwrap().rows[0][0].grow = Some(f64::NEG_INFINITY);
    config.normalize();
    assert_eq!(
        config.rows[0].iter().map(|key| key.grow).collect::<Vec<_>>(),
        vec![Some(0.5), Some(1.75), Some(12.0), None]
    );
    let bottom = config.bottom.unwrap();
    assert_eq!(bottom.rows[0][0].grow, None);
    assert_eq!(bottom.enter.unwrap().grow, Some(12.0));
}

#[test]
fn action_keyboard_normalize_applies_kind_contract() {
    let mut config = parse_action_keyboard(
        r#"{
            "rows":[[
                {"label":"future","kind":"future-kind","action":"newTab","send":"kept","special":"bookmarks"},
                {"label":"missing","kind":"action","send":"keep","repeat":true},
                {"label":"blank","kind":"action","action":"  ","send":"keep","auto_enter":true},
                {"label":"valid","kind":"action","action":"newTab","send":"remove","special":"bookmarks","repeat":true,"auto_enter":true,"grow":1.5},
                {"label":"bookmarks","special":"bookmarks"}
            ]]
        }"#,
    );
    config.normalize();

    let keys = &config.rows[0];
    assert_eq!(keys[0].kind.as_deref(), Some("send"));
    assert_eq!(keys[0].action.as_deref(), Some("newTab"));
    assert_eq!(keys[0].send, "kept");
    assert_eq!(keys[0].special.as_deref(), Some("bookmarks"));

    assert_eq!(keys[1].send, "keep");
    assert!(keys[1].repeat);
    assert_eq!(keys[2].send, "keep");
    assert!(keys[2].auto_enter);

    assert!(keys[3].send.is_empty());
    assert!(keys[3].special.is_none());
    assert!(!keys[3].repeat);
    assert!(!keys[3].auto_enter);
    let valid_action_json = serde_json::to_value(&keys[3]).unwrap();
    for forbidden in ["send", "special", "repeat", "auto_enter"] {
        assert!(valid_action_json.get(forbidden).is_none(), "{forbidden} survived");
    }

    assert!(keys[4].send.is_empty());
    assert_eq!(keys[4].special.as_deref(), Some("bookmarks"));
}

#[test]
fn action_keyboard_normalize_is_idempotent_for_active_and_snapshot_slots() {
    let invalid = parse_action_keyboard(
        r#"{
            "rows":[[{"label":"Action","kind":"action","action":"newTab","send":"remove","grow":20}]],
            "bottom":{"rows":[],"enter":{"label":"Custom","kind":"action","action":"newTab"},"enter_width":0.9}
        }"#,
    );
    let mut settings = Settings {
        action_keyboard: Some(invalid.clone()),
        action_keyboard_user_default: Some(invalid),
        ..Settings::default()
    };

    assert!(normalize_action_keyboards(&mut settings));
    let once = serde_json::to_value((
        settings.action_keyboard.as_ref(),
        settings.action_keyboard_user_default.as_ref(),
    ))
    .unwrap();
    assert!(!normalize_action_keyboards(&mut settings));
    let twice = serde_json::to_value((
        settings.action_keyboard.as_ref(),
        settings.action_keyboard_user_default.as_ref(),
    ))
    .unwrap();
    assert_eq!(twice, once);
}

#[test]
fn action_keyboard_normalize_keeps_valid_shape_and_drops_bogus() {
    let mut config = parse_action_keyboard(
        r#"{
            "rows":[[
                {"label":"arrow","send":"up","shape":"arrow"},
                {"label":"button","send":"yes\r","shape":"button"},
                {"label":"bogus","send":"no\r","shape":"wide"}
            ]]
        }"#,
    );
    config.normalize();

    assert_eq!(config.rows[0][0].shape.as_deref(), Some("arrow"));
    assert_eq!(config.rows[0][1].shape.as_deref(), Some("button"));
    assert_eq!(config.rows[0][2].shape, None);

    let wire = serde_json::to_value(&config).unwrap();
    assert_eq!(wire["rows"][0][0]["shape"], "arrow");
    assert_eq!(wire["rows"][0][1]["shape"], "button");
    assert!(wire["rows"][0][2].get("shape").is_none());
}

#[test]
fn clamp_theme_on_put_rejects_base_names_from_hidden() {
    let mut settings = Settings {
        hidden_builtins: ["dark", "nord", "light", "dracula", "nord"]
            .into_iter()
            .map(str::to_string)
            .collect(),
        ..Default::default()
    };

    assert!(clamp_theme_on_put(&mut settings));
    assert_eq!(settings.hidden_builtins, vec!["nord"]);
}

#[test]
fn clamp_theme_on_put_caps_custom_themes_at_15() {
    let mut settings = Settings {
        custom_themes: (0..17)
            .map(|i| sample_theme(&format!("uuid-{i}"), &format!("Theme {i}")))
            .collect(),
        ..Default::default()
    };

    assert!(clamp_theme_on_put(&mut settings));
    assert_eq!(settings.custom_themes.len(), 15);
}

#[test]
fn deserialize_preserves_over_cap_and_dup_uuid_custom_themes() {
    let mut settings = Settings {
        custom_themes: (0..17)
            .map(|i| sample_theme(&format!("uuid-{i}"), &format!("Theme {i}")))
            .collect(),
        ..Default::default()
    };
    settings.custom_themes.push(sample_theme("uuid-0", "Duplicate UUID"));

    let serialized = serde_json::to_string(&settings).unwrap();
    let restored: Settings = serde_json::from_str(&serialized).unwrap();

    assert_eq!(restored.custom_themes.len(), 18);
}

#[test]
fn clamp_theme_normalizes_short_hex() {
    let mut settings = Settings::default();
    let mut theme = sample_theme("theme-1", "Short Hex");
    theme.colors.foreground = "#FFF".to_string();
    settings.custom_themes.push(theme);

    assert!(clamp_theme_on_put(&mut settings));
    assert_eq!(settings.custom_themes[0].colors.foreground, "#ffffff");
}

#[test]
fn deserialize_does_not_normalize_theme_colors() {
    let mut settings = Settings::default();
    let mut theme = sample_theme("theme-1", "Malformed Color");
    theme.colors.foreground = "#ZZZ".to_string();
    settings.custom_themes.push(theme);

    let serialized = serde_json::to_string(&settings).unwrap();
    let restored: Settings = serde_json::from_str(&serialized).unwrap();

    assert_eq!(restored.custom_themes[0].colors.foreground, "#ZZZ");
}
